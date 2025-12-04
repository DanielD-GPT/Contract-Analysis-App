// State management
let currentDocument = null;
let documentContent = [];
let originalDocumentContent = []; // Store original content for restore
let currentFilter = 'all';
let currentSearchQuery = ''; // Current search query
let pdfDoc = null;
let currentPage = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.725; // Increased by 15% from 1.5
let pdfTextContent = [];
let currentPageDimensions = { width: 8.5, height: 11 }; // Will be updated from PDF

// PDF.js setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM elements
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileName = document.getElementById('fileName');
const loadingOverlay = document.getElementById('loadingOverlay');
const documentViewerContent = document.getElementById('documentViewerContent');
const pdfContainer = document.getElementById('pdfContainer');
const pdfCanvas = document.getElementById('pdfCanvas');
const textLayer = document.getElementById('textLayer');
const boundingBoxLayer = document.getElementById('boundingBoxLayer');
const contentListContent = document.getElementById('contentListContent');
const contentDetails = document.getElementById('contentDetails');
const selectedContent = document.getElementById('selectedContent');
const contentPage = document.getElementById('contentPage');
const contentType = document.getElementById('contentType');
const questionInput = document.getElementById('questionInput');
const askBtn = document.getElementById('askBtn');
const chatHistory = document.getElementById('chatHistory');
const itemCount = document.getElementById('itemCount');
const restoreBtn = document.getElementById('restoreBtn');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const pageNavigation = document.getElementById('pageNavigation');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInput = document.getElementById('pageInput');
const totalPagesSpan = document.getElementById('totalPages');

// Event listeners
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);
askBtn.addEventListener('click', handleQuestion);
restoreBtn.addEventListener('click', handleRestoreAll);

// Page navigation
prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    goToPage(currentPage - 1);
  }
});

nextPageBtn.addEventListener('click', () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) {
    goToPage(currentPage + 1);
  }
});

pageInput.addEventListener('change', (e) => {
  const pageNum = parseInt(e.target.value);
  if (pdfDoc && pageNum >= 1 && pageNum <= pdfDoc.numPages) {
    goToPage(pageNum);
  } else {
    e.target.value = currentPage;
  }
});

pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.target.blur();
  }
});

// Search functionality
searchInput.addEventListener('input', (e) => {
  currentSearchQuery = e.target.value;
  clearSearchBtn.style.display = currentSearchQuery ? 'flex' : 'none';
  renderContentList();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentSearchQuery = '';
  clearSearchBtn.style.display = 'none';
  renderContentList();
});

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentFilter = e.target.dataset.filter;
    renderContentList();
  });
});

// Handle Enter key in question input
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    handleQuestion();
  }
});

// File upload handler
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  fileName.textContent = file.name;
  showLoading(true);

  const formData = new FormData();
  formData.append('document', file);

  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Failed to analyze document');
    }

    const data = await response.json();
    currentDocument = data;
    documentContent = data.content.items;
    originalDocumentContent = [...data.content.items]; // Store original for restore

    // Display PDF
    displayPDF(data.filePath);

    // Render content list
    renderContentList();

    // Enable Q&A
    askBtn.disabled = false;

    showNotification('Document analyzed successfully!', 'success');

  } catch (error) {
    console.error('Upload error:', error);
    showNotification('Failed to analyze document: ' + error.message, 'error');
  } finally {
    showLoading(false);
  }
}

// Display PDF in viewer
function displayPDF(filePath) {
  const emptyState = documentViewerContent.querySelector('.empty-state');
  if (emptyState) {
    emptyState.style.display = 'none';
  }

  pdfContainer.style.display = 'block';

  const url = `http://localhost:3000${filePath}`;
  
  pdfjsLib.getDocument(url).promise.then(function(pdfDoc_) {
    pdfDoc = pdfDoc_;
    
    // Update page navigation UI
    pageNavigation.style.display = 'flex';
    totalPagesSpan.textContent = pdfDoc.numPages;
    pageInput.max = pdfDoc.numPages;
    pageInput.value = 1;
    updatePageNavButtons();
    
    // Render first page
    renderPage(1);
  }).catch(function(error) {
    console.error('Error loading PDF:', error);
    showNotification('Failed to load PDF', 'error');
  });
}

// Go to a specific page
function goToPage(num) {
  if (!pdfDoc || num < 1 || num > pdfDoc.numPages) return;
  renderPage(num);
  pageInput.value = num;
  updatePageNavButtons();
}

// Update page navigation button states
function updatePageNavButtons() {
  if (!pdfDoc) return;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= pdfDoc.numPages;
}

// Render a specific page
function renderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
    return;
  }
  
  pageRendering = true;
  currentPage = num;
  
  // Update page input and buttons
  pageInput.value = num;
  updatePageNavButtons();

  pdfDoc.getPage(num).then(function(page) {
    const viewport = page.getViewport({ scale: scale });
    const canvas = pdfCanvas;
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    // Get actual page dimensions in inches (72 points per inch in PDF)
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    currentPageDimensions = {
      width: unscaledViewport.width / 72,  // Convert points to inches
      height: unscaledViewport.height / 72
    };

    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };

    const renderTask = page.render(renderContext);

    renderTask.promise.then(function() {
      pageRendering = false;
      
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
      
      // Render text layer for highlighting
      renderTextLayer(page, viewport);
      
      // Render bounding boxes for extracted content
      renderBoundingBoxes(viewport);
    });
  });
}

// Render text layer for text selection and highlighting
function renderTextLayer(page, viewport) {
  page.getTextContent().then(function(textContent) {
    // Clear previous text layer
    textLayer.innerHTML = '';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';

    // Store text content for this page
    pdfTextContent[currentPage] = textContent;

    textContent.items.forEach(function(textItem) {
      const tx = pdfjsLib.Util.transform(
        viewport.transform,
        textItem.transform
      );
      
      const style = textContent.styles[textItem.fontName];
      const span = document.createElement('span');
      span.textContent = textItem.str;
      span.style.left = tx[4] + 'px';
      span.style.top = (tx[5] - textItem.height) + 'px';
      span.style.fontSize = (textItem.height) + 'px';
      span.style.fontFamily = style ? style.fontFamily : 'sans-serif';
      span.setAttribute('data-text', textItem.str);
      
      textLayer.appendChild(span);
    });
  });
}

// Parse bounding box source string: D(page,x1,y1,x2,y2,x3,y3,x4,y4)
function parseBoundingBoxSource(source) {
  if (!source) return null;
  
  // Handle multiple bounding boxes separated by semicolons
  const boxes = source.split(';').map(boxStr => {
    const match = boxStr.match(/D\((\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/);
    if (!match) return null;
    
    return {
      page: parseInt(match[1]),
      points: [
        { x: parseFloat(match[2]), y: parseFloat(match[3]) },
        { x: parseFloat(match[4]), y: parseFloat(match[5]) },
        { x: parseFloat(match[6]), y: parseFloat(match[7]) },
        { x: parseFloat(match[8]), y: parseFloat(match[9]) }
      ]
    };
  }).filter(box => box !== null);
  
  return boxes.length > 0 ? boxes : null;
}

// Convert inch coordinates to pixel coordinates
function inchesToPixels(boxes, viewport) {
  // Use actual page dimensions from PDF
  const pageWidth = currentPageDimensions.width;
  const pageHeight = currentPageDimensions.height;
  
  // Scale factors: viewport pixels per inch
  const scaleX = viewport.width / pageWidth;
  const scaleY = viewport.height / pageHeight;
  
  return boxes.map(box => {
    const pixelPoints = box.points.map(pt => ({
      x: pt.x * scaleX,
      y: pt.y * scaleY
    }));
    
    // Calculate bounding rectangle from polygon points
    const minX = Math.min(...pixelPoints.map(p => p.x));
    const maxX = Math.max(...pixelPoints.map(p => p.x));
    const minY = Math.min(...pixelPoints.map(p => p.y));
    const maxY = Math.max(...pixelPoints.map(p => p.y));
    
    return {
      page: box.page,
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  });
}

// Render bounding boxes for all extracted content on current page
function renderBoundingBoxes(viewport) {
  // Clear previous bounding boxes
  boundingBoxLayer.innerHTML = '';
  boundingBoxLayer.style.width = viewport.width + 'px';
  boundingBoxLayer.style.height = viewport.height + 'px';
  
  if (!documentContent || documentContent.length === 0) return;
  
  // Scale factors: viewport pixels per inch
  const pageWidth = currentPageDimensions.width;
  const pageHeight = currentPageDimensions.height;
  const scaleX = viewport.width / pageWidth;
  const scaleY = viewport.height / pageHeight;
  
  console.log('Rendering bounding boxes - Scale:', { scaleX, scaleY, pageWidth, pageHeight });
  
  documentContent.forEach((item, index) => {
    // Use boundingBox array directly if available (8 values: x1,y1,x2,y2,x3,y3,x4,y4 in inches)
    if (!item.boundingBox || item.boundingBox.length < 8) return;
    if (item.page !== currentPage) return;
    
    const p = item.boundingBox;
    
    // Convert polygon points from inches to pixels
    // Polygon format: [x1,y1, x2,y2, x3,y3, x4,y4] - four corners
    const points = [
      { x: p[0] * scaleX, y: p[1] * scaleY },
      { x: p[2] * scaleX, y: p[3] * scaleY },
      { x: p[4] * scaleX, y: p[5] * scaleY },
      { x: p[6] * scaleX, y: p[7] * scaleY }
    ];
    
    // Calculate bounding rectangle from polygon points
    const minX = Math.min(...points.map(pt => pt.x));
    const maxX = Math.max(...points.map(pt => pt.x));
    const minY = Math.min(...points.map(pt => pt.y));
    const maxY = Math.max(...points.map(pt => pt.y));
    
    const boxEl = document.createElement('div');
    boxEl.className = `bounding-box ${item.type}`;
    boxEl.setAttribute('data-id', item.id);
    boxEl.setAttribute('data-index', index);
    boxEl.style.left = minX + 'px';
    boxEl.style.top = minY + 'px';
    boxEl.style.width = (maxX - minX) + 'px';
    boxEl.style.height = (maxY - minY) + 'px';
    
    // Click handler to select this item
    boxEl.addEventListener('click', () => {
      selectContentItem(item.id);
    });
    
    boundingBoxLayer.appendChild(boxEl);
  });
}

// Select a content item by ID (from bounding box click)
function selectContentItem(itemId) {
  // Find and click the corresponding item in the list
  const listItem = document.querySelector(`.content-item[data-id="${itemId}"]`);
  if (listItem) {
    handleContentItemClick(listItem);
    listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Render content list
function renderContentList() {
  if (!documentContent || documentContent.length === 0) {
    contentListContent.innerHTML = '<div class="empty-state"><p>No content extracted yet</p></div>';
    itemCount.textContent = '0 items';
    restoreBtn.style.display = 'none';
    return;
  }

  const filteredContent = documentContent.filter(item => {
    // Apply type filter
    const matchesType = currentFilter === 'all' || item.type === currentFilter;
    
    // Apply search filter (case-insensitive exact match)
    const matchesSearch = !currentSearchQuery || 
      item.content.toLowerCase().includes(currentSearchQuery.toLowerCase());
    
    return matchesType && matchesSearch;
  });

  // Update item count - show filtered count when searching
  const totalItems = documentContent.length;
  const originalItems = originalDocumentContent.length;
  if (currentSearchQuery) {
    itemCount.textContent = `${filteredContent.length} matches`;
  } else {
    itemCount.textContent = `${totalItems} of ${originalItems} items`;
  }
  
  // Show restore button if items were deleted
  if (totalItems < originalItems) {
    restoreBtn.style.display = 'block';
  } else {
    restoreBtn.style.display = 'none';
  }

  if (filteredContent.length === 0) {
    const message = currentSearchQuery 
      ? `No items match "${escapeHtml(currentSearchQuery)}"` 
      : 'No items match the filter';
    contentListContent.innerHTML = `<div class="empty-state"><p>${message}</p></div>`;
    return;
  }

  const html = filteredContent.map((item, index) => `
    <div class="content-item ${item.type}" data-id="${item.id}" data-index="${index}">
      <div class="content-item-content">
        <div class="content-item-text">${escapeHtml(item.content)}</div>
        <div class="content-item-meta">
          <span class="meta-badge ${item.type}">${item.type}</span>
          <span class="meta-badge">Page ${item.page}</span>
        </div>
      </div>
      <button class="delete-btn" data-id="${item.id}" title="Delete this item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  `).join('');

  contentListContent.innerHTML = html;

  // Add click listeners for items
  document.querySelectorAll('.content-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger item click if delete button was clicked
      if (!e.target.closest('.delete-btn')) {
        handleContentItemClick(item);
      }
    });
  });

  // Add click listeners for delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteItem(btn.dataset.id);
    });
  });
}

// Handle content item click
function handleContentItemClick(element) {
  // Remove active class from all items
  document.querySelectorAll('.content-item').forEach(item => {
    item.classList.remove('active');
  });

  // Add active class to clicked item
  element.classList.add('active');

  // Get item data
  const itemId = element.dataset.id;
  const item = documentContent.find(i => i.id === itemId);

  if (!item) return;

  // Show content details
  contentDetails.style.display = 'block';
  selectedContent.textContent = item.content;
  contentPage.textContent = `Page ${item.page}`;
  contentPage.className = 'meta-badge';
  contentType.textContent = item.type;
  contentType.className = `meta-badge ${item.type}`;

  // Navigate to the page and highlight the text
  if (pdfDoc && item.page !== currentPage) {
    renderPage(item.page);
    // Wait for page to render before highlighting
    setTimeout(() => {
      highlightTextInPDF(item.content);
      highlightBoundingBox(item.id);
    }, 500);
  } else {
    highlightTextInPDF(item.content);
    highlightBoundingBox(item.id);
  }
}

// Highlight a specific bounding box
function highlightBoundingBox(itemId) {
  // Remove previous selection
  document.querySelectorAll('.bounding-box.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  // Add selection to matching boxes
  const boxes = document.querySelectorAll(`.bounding-box[data-id="${itemId}"]`);
  boxes.forEach(box => {
    box.classList.add('selected');
    // Scroll the first box into view
    if (box === boxes[0]) {
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

// Highlight text in the PDF
function highlightTextInPDF(searchText) {
  // Remove previous highlights
  document.querySelectorAll('.textLayer .highlight').forEach(el => {
    el.classList.remove('highlight');
  });

  if (!searchText || !textLayer) return;

  // Normalize search text
  const normalizedSearch = searchText.toLowerCase().trim();
  
  // Get all text spans in the text layer
  const textSpans = Array.from(textLayer.querySelectorAll('span'));
  
  // Find matching text using a sliding window approach
  let foundMatch = false;
  const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0);
  
  if (searchWords.length === 0) return;

  // Try to find the first few words to locate the content
  const searchStart = searchWords.slice(0, Math.min(5, searchWords.length)).join(' ');
  
  for (let i = 0; i < textSpans.length; i++) {
    let concatenatedText = '';
    let matchingSpans = [];
    
    // Build up text from consecutive spans
    for (let j = i; j < Math.min(i + 50, textSpans.length); j++) {
      const spanText = textSpans[j].textContent;
      concatenatedText += spanText + ' ';
      matchingSpans.push(textSpans[j]);
      
      const normalizedConcat = concatenatedText.toLowerCase().trim();
      
      // Check if we found the start of our search text
      if (normalizedConcat.includes(searchStart)) {
        // Highlight all matching spans
        matchingSpans.forEach(span => {
          span.classList.add('highlight');
        });
        
        foundMatch = true;
        
        // Scroll to the highlighted element
        if (matchingSpans.length > 0) {
          matchingSpans[0].scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
        
        break;
      }
    }
    
    if (foundMatch) break;
  }
  
  if (!foundMatch) {
    // Fallback: try simple text matching
    textSpans.forEach(span => {
      const spanText = span.textContent.toLowerCase();
      if (searchWords.some(word => spanText.includes(word))) {
        span.classList.add('highlight');
        if (!foundMatch) {
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          foundMatch = true;
        }
      }
    });
  }
}

// Handle delete item
function handleDeleteItem(itemId) {
  // Find the item
  const item = documentContent.find(i => i.id === itemId);
  
  if (!item) return;

  // Remove from documentContent array
  const index = documentContent.findIndex(i => i.id === itemId);
  if (index > -1) {
    documentContent.splice(index, 1);
  }

  // If this item was selected, clear the details pane
  const activeItem = document.querySelector('.content-item.active');
  if (activeItem && activeItem.dataset.id === itemId) {
    contentDetails.style.display = 'none';
    
    // Remove highlights
    document.querySelectorAll('.textLayer .highlight').forEach(el => {
      el.classList.remove('highlight');
    });
  }

  // Re-render the list
  renderContentList();

  showNotification(`${item.type.charAt(0).toUpperCase() + item.type.slice(1)} deleted`, 'success');
}

// Handle restore all items
function handleRestoreAll() {
  // Restore original content
  documentContent = [...originalDocumentContent];

  // Clear details pane
  contentDetails.style.display = 'none';
  
  // Remove highlights
  document.querySelectorAll('.textLayer .highlight').forEach(el => {
    el.classList.remove('highlight');
  });

  // Re-render the list
  renderContentList();

  showNotification('All items restored', 'success');
}

// Handle question submission
async function handleQuestion() {
  const question = questionInput.value.trim();
  if (!question) return;

  // Add question to chat
  addChatMessage(question, 'question');
  questionInput.value = '';

  // Disable input while processing
  askBtn.disabled = true;
  questionInput.disabled = true;

  try {
    const response = await fetch('http://localhost:3000/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error('Failed to get answer');
    }

    const data = await response.json();
    addChatMessage(data.answer, 'answer');

  } catch (error) {
    console.error('Query error:', error);
    addChatMessage('Sorry, I couldn\'t process your question: ' + error.message, 'error');
  } finally {
    askBtn.disabled = false;
    questionInput.disabled = false;
    questionInput.focus();
  }
}

// Add message to chat history
function addChatMessage(text, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${type}`;
  
  const label = type === 'question' ? 'You' : type === 'error' ? 'Error' : 'Assistant';
  
  messageDiv.innerHTML = `
    <div class="chat-message-label">${label}</div>
    <div>${escapeHtml(text)}</div>
  `;

  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Show/hide loading overlay
function showLoading(show) {
  loadingOverlay.style.display = show ? 'flex' : 'none';
}

// Show notification
function showNotification(message, type) {
  // Simple console notification
  // You could implement a toast notification system here
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
console.log('Contract Analysis App initialized');
