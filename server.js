const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const { DocumentAnalysisClient, AzureKeyCredential } = require('@azure/ai-form-recognizer');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Azure Document Intelligence Client
const documentClient = new DocumentAnalysisClient(
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY)
);

// Azure OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': '2024-02-01' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY }
});

// Store document context for LLM queries
let currentDocumentContext = '';

// Routes

// Upload and analyze document
app.post('/api/analyze', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileBuffer = await fs.readFile(filePath);

    // Analyze document with Azure Document Intelligence
    const poller = await documentClient.beginAnalyzeDocument(
      'prebuilt-layout',
      fileBuffer
    );

    const result = await poller.pollUntilDone();

    // Extract structured content
    const structuredContent = extractStructuredContent(result);
    
    // Store full text for LLM context
    currentDocumentContext = structuredContent.fullText;

    res.json({
      filename: req.file.originalname,
      filePath: `/uploads/${req.file.filename}`,
      content: structuredContent
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze document',
      details: error.message 
    });
  }
});

// Get uploaded file
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  res.sendFile(filePath);
});

// LLM Query endpoint
app.post('/api/query', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!currentDocumentContext) {
      return res.status(400).json({ 
        error: 'No document analyzed yet. Please upload a document first.' 
      });
    }

    console.log('Processing question with document context length:', currentDocumentContext.length);

    // Query Azure OpenAI with full document context
    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that analyzes contracts and legal documents. You have access to the ENTIRE document content provided below. When answering questions, search through and analyze ALL parts of the document to provide accurate and comprehensive answers. Cite specific sections, clauses, or page references when relevant.'
        },
        {
          role: 'user',
          content: `Here is the complete document content:\n\n${currentDocumentContext}\n\n---\n\nBased on the ENTIRE document above, please answer this question: ${question}`
        }
      ],
      max_tokens: 1500,
      temperature: 0.3
    });

    const answer = response.choices[0].message.content;

    res.json({ answer });

  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ 
      error: 'Failed to process query',
      details: error.message 
    });
  }
});

// Helper function to convert polygon from array of {x,y} objects to flat array
function flattenPolygon(polygon) {
  if (!polygon || !Array.isArray(polygon)) return null;
  // If already flat array of numbers, return as-is
  if (typeof polygon[0] === 'number') return polygon;
  // If array of {x, y} objects, flatten
  if (polygon[0] && typeof polygon[0].x === 'number') {
    return polygon.flatMap(pt => [pt.x, pt.y]);
  }
  return null;
}

// Helper function to extract structured content
function extractStructuredContent(result) {
  const items = [];
  let fullText = '';

  // Build a map of line polygons by page for lookup
  const linePolygonMap = new Map();
  if (result.pages) {
    result.pages.forEach(page => {
      if (page.lines) {
        page.lines.forEach(line => {
          const key = `${page.pageNumber}:${line.content.trim()}`;
          const flatPoly = flattenPolygon(line.polygon);
          if (!linePolygonMap.has(key) && flatPoly && flatPoly.length >= 8) {
            linePolygonMap.set(key, {
              page: page.pageNumber,
              polygon: flatPoly
            });
          }
        });
      }
    });
  }

  // Function to find the best matching line polygon for content
  function findLinePolygon(content, pageNumber) {
    // First try exact match
    const exactKey = `${pageNumber}:${content.trim()}`;
    if (linePolygonMap.has(exactKey)) {
      return linePolygonMap.get(exactKey);
    }
    
    // For multi-line content, find the first line match
    const firstLine = content.split('\n')[0].trim();
    const firstLineKey = `${pageNumber}:${firstLine}`;
    if (linePolygonMap.has(firstLineKey)) {
      return linePolygonMap.get(firstLineKey);
    }
    
    // Try to find partial match (content starts with line)
    for (const [key, value] of linePolygonMap) {
      if (key.startsWith(`${pageNumber}:`) && content.trim().startsWith(key.split(':')[1])) {
        return value;
      }
    }
    
    return null;
  }

  if (result.paragraphs) {
    result.paragraphs.forEach((paragraph, index) => {
      const content = paragraph.content;
      const role = paragraph.role || 'paragraph';
      
      fullText += content + '\n\n';

      // Determine if it's a heading based on multiple criteria
      const isHeading = role === 'title' || 
                        role === 'sectionHeading' ||
                        role === 'pageHeader' ||
                        // Check if text appears bold (often indicated by specific styling)
                        (content.length < 150 && 
                         (content.match(/^[A-Z][A-Z\s]+$/) || // ALL CAPS headings
                          content.match(/^\d+\./) || // Numbered sections like "1." or "1.1"
                          content.match(/^Article\s+[IVX\d]+/i) || // Article I, Article 1, etc.
                          content.match(/^Section\s+[\d\.]+/i) || // Section 1, Section 1.1
                          content.match(/^ARTICLE\s+[IVX\d]+/i) ||
                          content.match(/^SECTION\s+[\d\.]+/i) ||
                          content.match(/^[A-Z][^.!?]*:$/) || // Title Case ending with colon
                          content.match(/^Clause\s+[\d\.]+/i))); // Clause numbers

      const pageNumber = paragraph.boundingRegions?.[0]?.pageNumber || 1;
      
      // Use the paragraph's full bounding polygon - this encompasses the entire paragraph
      // For multi-line paragraphs, this is essential to cover all the text
      let boundingPolygon = flattenPolygon(paragraph.boundingRegions?.[0]?.polygon) || [];
      
      // Build source string from all bounding regions (paragraph may span multiple regions)
      let source = null;
      if (paragraph.boundingRegions && paragraph.boundingRegions.length > 0) {
        const sources = paragraph.boundingRegions.map(region => {
          const flatPoly = flattenPolygon(region.polygon);
          if (flatPoly && flatPoly.length >= 8) {
            const p = flatPoly;
            return `D(${region.pageNumber},${p[0]},${p[1]},${p[2]},${p[3]},${p[4]},${p[5]},${p[6]},${p[7]})`;
          }
          return null;
        }).filter(s => s);
        source = sources.join(';');
      }

      items.push({
        id: `item-${index}`,
        type: isHeading ? 'heading' : 'paragraph',
        content: content,
        page: pageNumber,
        boundingBox: boundingPolygon,
        source: source
      });
    });
  }

  // If no paragraphs, use pages
  if (items.length === 0 && result.pages) {
    result.pages.forEach((page, pageIndex) => {
      if (page.lines) {
        page.lines.forEach((line, lineIndex) => {
          fullText += line.content + '\n';
          
          const content = line.content;
          const isHeading = content.length < 150 && 
                           (content.match(/^[A-Z][A-Z\s]+$/) || 
                            content.match(/^\d+\./) ||
                            content.match(/^Article\s+[IVX\d]+/i) ||
                            content.match(/^Section\s+[\d\.]+/i) ||
                            content.match(/^ARTICLE\s+[IVX\d]+/i) ||
                            content.match(/^SECTION\s+[\d\.]+/i) ||
                            content.match(/^[A-Z][^.!?]*:$/) ||
                            content.match(/^Clause\s+[\d\.]+/i));
          
          // Get source from line - flatten polygon first
          const flatPoly = flattenPolygon(line.polygon);
          let source = null;
          if (flatPoly && flatPoly.length >= 8) {
            const p = flatPoly;
            source = `D(${page.pageNumber},${p[0]},${p[1]},${p[2]},${p[3]},${p[4]},${p[5]},${p[6]},${p[7]})`;
          }
          
          items.push({
            id: `page-${pageIndex}-line-${lineIndex}`,
            type: isHeading ? 'heading' : 'paragraph',
            content: content,
            page: page.pageNumber,
            boundingBox: flatPoly || [],
            source: source
          });
        });
      }
    });
  }

  return {
    items,
    fullText,
    pageCount: result.pages?.length || 0
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to configure your .env file with Azure credentials');
});
