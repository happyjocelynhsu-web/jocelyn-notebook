// app.js - Application Coordinator & Controller

import { db } from './db.js';
import { Book } from './book.js';
import { CanvasManager } from './canvas.js';
import { TextManager } from './text.js';

let book = null;
const canvasManagers = {};
const textManagers = {};
let currentActiveSharePage = null; // Currently selected page number for sharing config

// Safely calculate bounding boxes, bypassing Safari WebKit 3D transformed client rect bugs on rotated pages
window.getSafeRect = function(element, pageNum) {
  if (!element) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  
  if (pageNum) {
    const bookEl = document.getElementById('notebook');
    if (bookEl) {
      const bookRect = bookEl.getBoundingClientRect();
      const isDouble = window.book && window.book.layoutMode === 'double';
      
      if (isDouble) {
        const isLeftPage = (pageNum % 2 !== 0); // Odd pages are left!
        if (isLeftPage) {
          return {
            left: bookRect.left,
            right: bookRect.left + bookRect.width / 2,
            top: bookRect.top,
            bottom: bookRect.bottom,
            width: bookRect.width / 2,
            height: bookRect.height,
            x: bookRect.left,
            y: bookRect.top
          };
        } else {
          return {
            left: bookRect.left + bookRect.width / 2,
            right: bookRect.right,
            top: bookRect.top,
            bottom: bookRect.bottom,
            width: bookRect.width / 2,
            height: bookRect.height,
            x: bookRect.left + bookRect.width / 2,
            y: bookRect.top
          };
        }
      } else {
        // Single-page layout mode: active page occupies the entire notebook container
        return {
          left: bookRect.left,
          right: bookRect.right,
          top: bookRect.top,
          bottom: bookRect.bottom,
          width: bookRect.width,
          height: bookRect.height,
          x: bookRect.left,
          y: bookRect.top
        };
      }
    }
  }
  
  return element.getBoundingClientRect();
};

// Page range for content (editable)
let EDITABLE_PAGES = [];

function updateEditablePagesList() {
  EDITABLE_PAGES = [1]; // Start with Page 1 as editable content page!
  const numContentSheets = parseInt(localStorage.getItem('notebook_content_sheets') || '3');
  for (let i = 1; i <= numContentSheets; i++) {
    EDITABLE_PAGES.push(i * 2);
    EDITABLE_PAGES.push(i * 2 + 1);
  }
}
updateEditablePagesList();

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  const route = getRoute();
  
  // Default to read-only mode, UNLESS ?edit=true or ?mode=edit is specified in the URL
  const urlParams = new URLSearchParams(window.location.search);
  const isEditMode = urlParams.get('edit') === 'true' || urlParams.get('mode') === 'edit';
  
  if (!isEditMode) {
    document.body.classList.add('readonly-mode');
  }
  
  if (route.name === 'share') {
    // 1. Read-only single shared page view
    document.body.classList.add('readonly-mode');
    await renderSharedPage(route.id);
  } else {
    // 2. Main Book mode (run in read-only or edit mode depending on 'readonly-mode' class on body)
    initEditor();
  }
}

// Simple Hash/Path Route parser
function getRoute() {
  const hash = window.location.hash;
  const path = window.location.pathname;
  
  if (hash.startsWith('#/share/')) {
    return { name: 'share', id: hash.replace('#/share/', '') };
  }
  if (path.startsWith('/share/')) {
    return { name: 'share', id: path.replace('/share/', '') };
  }
  
  // Also support query param fallback: ?share=page_id
  const urlParams = new URLSearchParams(window.location.search);
  const shareParam = urlParams.get('share');
  if (shareParam) {
    return { name: 'share', id: shareParam };
  }

  return { name: 'editor' };
}

/* =========================================================================
   SHARE VIEW LOGIC
   ========================================================================= */

async function renderSharedPage(pageId) {
  const bookStage = document.querySelector('.book-stage');
  bookStage.innerHTML = ''; // Clear book container

  // Create single page envelope
  const singlePageContainer = document.createElement('div');
  singlePageContainer.className = 'notebook-container';
  singlePageContainer.style.width = '480px';
  singlePageContainer.style.height = '600px';
  singlePageContainer.style.transform = 'scale(1)';
  
  // Set up auto scaler for single page
  const scalePage = () => {
    const parent = bookStage;
    const parentWidth = parent.clientWidth - 40;
    const parentHeight = parent.clientHeight - 80;
    const scale = Math.min(1, Math.min(parentWidth / 480, parentHeight / 600));
    singlePageContainer.style.transform = `scale(${Math.max(0.45, scale)})`;
  };
  window.addEventListener('resize', scalePage);
  
  // Fetch shared page data
  const pageData = await db.loadSharedPage(pageId);

  if (!pageData) {
    // Private page or error
    singlePageContainer.innerHTML = `
      <div class="page front" style="border-radius: 8px;">
        <div class="private-cover">
          <i data-lucide="lock"></i>
          <h2>私人頁面或不存在</h2>
          <p>此頁面未開啟公開分享，或該筆記本尚未建立雲端連接。</p>
        </div>
      </div>
    `;
    bookStage.appendChild(singlePageContainer);
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Create page DOM structure
  singlePageContainer.innerHTML = `
    <div class="page front" style="border-radius: 8px;">
      <div class="paper-inner">
        <div class="page-header">
          <span>反重力分享筆記</span>
          <span>Page ${pageData.page_num}</span>
        </div>
        <div class="page-body-container" id="shared-page-body">
          <div class="text-layer" id="shared-text-layer"></div>
          <canvas class="drawing-canvas" id="shared-canvas"></canvas>
        </div>
        <div class="page-footer">由 Antigravity Notebook 分享</div>
      </div>
    </div>
  `;
  bookStage.appendChild(singlePageContainer);
  if (window.lucide) window.lucide.createIcons();
  
  // Initialize Canvas and Text layers in read-only mode
  const canvasEl = document.getElementById('shared-canvas');
  const textLayerEl = document.getElementById('shared-text-layer');

  const canvasMgr = new CanvasManager(canvasEl, { isReadOnly: true });
  canvasMgr.loadPaths(pageData.drawings);

  const textMgr = new TextManager(textLayerEl, { isReadOnly: true });
  textMgr.loadTexts(pageData.texts);

  scalePage();
}

/* =========================================================================
   EDITOR MODE LOGIC
   ========================================================================= */

async function initEditor() {
  // 1. Setup Help Modal
  setupModal('help-btn', 'help-modal');
  setupModal('db-status-btn', 'db-modal');
  
  // Show guide modal on first visit
  if (!localStorage.getItem('antigravity_visited')) {
    document.getElementById('help-modal').classList.remove('hidden');
    localStorage.setItem('antigravity_visited', 'true');
  }

  // 2. Setup Supabase settings connection UI
  setupDbConnectionUI();

  // Sync Pencil Only palm rejection options
  const pencilToggle = document.getElementById('pencil-only-toggle');
  if (pencilToggle) {
    pencilToggle.addEventListener('change', (e) => {
      const checked = e.target.checked;
      updateAllCanvasBrushes(mgr => {
        mgr.pencilOnly = checked;
      });
    });
  }

  // Auto-detect Pencil to check the box
  document.addEventListener('pencil-detected', () => {
    const toggle = document.getElementById('pencil-only-toggle');
    if (toggle) {
      toggle.checked = true;
    }
    updateAllCanvasBrushes(mgr => {
      mgr.pencilOnly = true;
    });
  });

  // 3. Initialize 3D book engine
  book = new Book('notebook', {
    onPageChange: (state) => handleBookPageChange(state)
  });
  window.book = book;

  // Setup navigation arrows
  document.getElementById('prev-page-btn').addEventListener('click', () => book.prev());
  document.getElementById('next-page-btn').addEventListener('click', () => book.next());

  // 4. Preload and initialize all editable pages
  await preloadPagesAndInitializeLayers();

  // Setup responsive sidebar toggle for tablets/mobile (Header Menu + Side Floating Handle)
  const sidebarToggle = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('editor-tools');
  const floatingToggle = document.getElementById('sidebar-toggle-floating');

  const toggleSidebar = () => {
    if (!sidebar) return;
    sidebar.classList.toggle('active');
    const isActive = sidebar.classList.contains('active');
    
    if (floatingToggle) {
      if (isActive) {
        floatingToggle.style.left = '280px';
        floatingToggle.innerHTML = '<i data-lucide="chevron-left"></i>';
      } else {
        floatingToggle.style.left = '0';
        floatingToggle.innerHTML = '<i data-lucide="chevron-right"></i>';
      }
      if (window.lucide) window.lucide.createIcons();
    }
  };

  if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
  if (floatingToggle) floatingToggle.addEventListener('click', toggleSidebar);

  // Setup layout controls (Double vs Single page)
  const layoutDoubleBtn = document.getElementById('layout-double-btn');
  const layoutSingleBtn = document.getElementById('layout-single-btn');
  if (layoutDoubleBtn && layoutSingleBtn) {
    layoutDoubleBtn.addEventListener('click', () => {
      layoutSingleBtn.classList.remove('active');
      layoutDoubleBtn.classList.add('active');
      layoutDoubleBtn.style.background = 'var(--color-primary)';
      layoutDoubleBtn.style.borderColor = 'var(--color-primary)';
      layoutDoubleBtn.style.color = 'white';
      layoutSingleBtn.style.background = 'rgba(255, 255, 255, 0.04)';
      layoutSingleBtn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      layoutSingleBtn.style.color = '#9ca3af';
      book.setLayoutMode('double');
    });

    layoutSingleBtn.addEventListener('click', () => {
      layoutDoubleBtn.classList.remove('active');
      layoutSingleBtn.classList.add('active');
      layoutSingleBtn.style.background = 'var(--color-primary)';
      layoutSingleBtn.style.borderColor = 'var(--color-primary)';
      layoutSingleBtn.style.color = 'white';
      layoutDoubleBtn.style.background = 'rgba(255, 255, 255, 0.04)';
      layoutDoubleBtn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      layoutDoubleBtn.style.color = '#9ca3af';
      book.setLayoutMode('single');
    });
  }

  // TOC Page Overview Modal Handlers
  const tocModal = document.getElementById('toc-modal');
  const tocGrid = document.getElementById('toc-grid');
  const tocBtn = document.getElementById('toc-btn');
  const closeTocBtn = document.getElementById('close-toc-btn');

  const createTOCCard = (pageNum, title, type) => {
    const card = document.createElement('div');
    card.className = 'toc-card';
    
    // Check if it matches the current viewport visible pages
    const currentPages = book.getCurrentPages();
    const isCurrent = (book.layoutMode === 'single' && book.activePageNum === pageNum) ||
                      (book.layoutMode === 'double' && (currentPages.left === pageNum || currentPages.right === pageNum));
    
    if (isCurrent) {
      card.classList.add('active');
    }

    let badgeHTML = '';
    if (isCurrent) {
      badgeHTML = `<span class="toc-card-badge">目前頁面</span>`;
    }

    card.innerHTML = `
      <div class="toc-card-header">
        <span>${type === 'content' ? '筆記內頁' : '系統頁'}</span>
        ${badgeHTML}
      </div>
      <div class="toc-card-title">${title}</div>
      <div class="toc-card-footer">
        <span>Page ${pageNum}</span>
        <i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i>
      </div>
    `;

    card.addEventListener('click', () => {
      book.flipToPage(pageNum);
      if (tocModal) tocModal.classList.add('hidden');
    });

    return card;
  };

  const renderTOC = () => {
    if (!tocGrid) return;
    tocGrid.innerHTML = '';

    // 1. Cover
    tocGrid.appendChild(createTOCCard(1, '封面 (Cover)', 'cover'));

    // 2. Content pages
    for (let i = 1; i <= book.totalContentSheets; i++) {
      const p1 = i * 2;
      const p2 = i * 2 + 1;
      tocGrid.appendChild(createTOCCard(p1, `第 ${p1} 頁`, 'content'));
      tocGrid.appendChild(createTOCCard(p2, `第 ${p2} 頁`, 'content'));
    }

    // 3. End page
    const endPage = (book.totalContentSheets + 1) * 2;
    tocGrid.appendChild(createTOCCard(endPage, `第 ${endPage} 頁 (尾聲)`, 'end'));

    // 4. Backcover
    const backCoverPage = endPage + 1;
    tocGrid.appendChild(createTOCCard(backCoverPage, '封底 (Back Cover)', 'backcover'));
  };

  if (tocBtn) {
    tocBtn.addEventListener('click', () => {
      renderTOC();
      if (window.lucide) window.lucide.createIcons();
      if (tocModal) tocModal.classList.remove('hidden');
    });
  }

  if (closeTocBtn && tocModal) {
    closeTocBtn.addEventListener('click', () => {
      tocModal.classList.add('hidden');
    });
  }

  // Add Page Button Click Handler
  const addPageBtn = document.getElementById('add-page-btn');
  if (addPageBtn) {
    addPageBtn.addEventListener('click', async () => {
      const oldMaxPage = book.totalPageCount; // e.g. 8
      const currentNumSheets = parseInt(localStorage.getItem('notebook_content_sheets') || '3');
      const newNumSheets = currentNumSheets + 1;
      localStorage.setItem('notebook_content_sheets', newNumSheets.toString());

      updateEditablePagesList();
      
      // Rebuild the 3D book and reinitialize all canvases and text blocks
      book.rebuild();
      await preloadPagesAndInitializeLayers();

      // Auto flip the user to the newly added page (which is oldMaxPage)
      book.flipToPage(oldMaxPage);

      alert(`已成功新增空白頁！目前筆記頁數已擴展至第 ${oldMaxPage} - ${oldMaxPage + 1} 頁。`);
    });
  }

  // 5. Initialize toolbar actions
  setupToolbarEvents();
  setupSketchbookEvents();
}

// Load drawings/texts for pages and init managers
async function preloadPagesAndInitializeLayers() {
  // Clear old manager records first to prevent memory leak and reference dead DOM nodes
  for (const pageNum in canvasManagers) delete canvasManagers[pageNum];
  for (const pageNum in textManagers) delete textManagers[pageNum];

  for (const pageNum of EDITABLE_PAGES) {
    const canvasEl = document.getElementById(`canvas-${pageNum}`);
    const textLayerEl = document.getElementById(`text-layer-${pageNum}`);
    
    if (!canvasEl || !textLayerEl) continue;

    // Fetch page data from DB / LocalCache
    const pageData = await db.loadPage(pageNum);
    const isReadOnly = document.body.classList.contains('readonly-mode');

    // Initialize Canvas
    const canvasMgr = new CanvasManager(canvasEl, {
      pageNum: pageNum,
      isReadOnly: isReadOnly,
      onSave: (paths) => handlePageSave(pageNum, paths, textManagers[pageNum] ? textManagers[pageNum].getTexts() : [])
    });
    
    // Bind layer status changed event listener
    canvasEl.addEventListener('layer-status-changed', (e) => {
      const { layers } = e.detail;
      syncTextMediaDOM(pageNum, layers);
      
      // Update floating layers list UI if this page is active/visible
      const currentPages = book ? book.getCurrentPages() : null;
      const isActivePage = currentPages && (pageNum === currentPages.left || pageNum === currentPages.right || pageNum === book.activePageNum);
      if (isActivePage) {
        renderLayersList();
      }
    });

    canvasMgr.loadPaths(pageData.drawings);
    canvasManagers[pageNum] = canvasMgr;

    // Initialize Text Layer
    const textMgr = new TextManager(textLayerEl, {
      pageNum: pageNum,
      isReadOnly: isReadOnly,
      onSave: (texts) => handlePageSave(pageNum, canvasManagers[pageNum] ? canvasManagers[pageNum].getPaths() : [], texts)
    });
    textMgr.loadTexts(pageData.texts);
    textManagers[pageNum] = textMgr;

    // --- Page Running Head Title Input initialization ---
    const titleTextObj = pageData.texts ? pageData.texts.find(t => t.id === 'page_title') : null;
    const titleInput = document.getElementById(`page-title-${pageNum}`);
    if (titleInput) {
      titleInput.value = titleTextObj ? titleTextObj.text : '';
      titleInput.readOnly = isReadOnly;
      if (isReadOnly) {
        titleInput.disabled = true;
      }
      
      // Bind input/change listener to save the title in IndexedDB/Supabase
      titleInput.addEventListener('change', async (e) => {
        const newTitle = e.target.value;
        const currentDrawings = canvasManagers[pageNum] ? canvasManagers[pageNum].getPaths() : [];
        const currentTexts = textManagers[pageNum] ? textManagers[pageNum].getTexts() : [];
        
        let titleObj = currentTexts.find(t => t.id === 'page_title');
        if (!titleObj) {
          titleObj = {
            id: 'page_title',
            text: newTitle,
            x: 0.5,
            y: -0.05,
            width: 100,
            height: 20
          };
          currentTexts.push(titleObj);
        } else {
          titleObj.text = newTitle;
        }
        
        await db.savePage(pageNum, currentDrawings, currentTexts);
      });
    }

    // --- Lasso Selection Synchronization with Text Blocks ---
    canvasEl.addEventListener('lasso-selected', (e) => {
      const fillSelectionBtn = document.getElementById('fill-selection-btn');
      if (fillSelectionBtn) {
        fillSelectionBtn.style.display = 'flex';
      }

      const { lassoPoints } = e.detail;
      const textMgrInstance = textManagers[pageNum];
      if (!textMgrInstance) return;

      // Reset selection
      if (textMgrInstance.selectedBlocks) {
        textMgrInstance.selectedBlocks.forEach(({ element }) => {
          element.classList.remove('selected-by-lasso');
        });
      }
      textMgrInstance.selectedBlocks = [];

      textMgrInstance.texts.forEach(item => {
        const tx = (item.x + (item.width || 40) / 2) / 100;
        const ty = (item.y + (item.height || 25) / 2) / 100;
        if (canvasManagers[pageNum].isPointInPolygon(tx, ty, lassoPoints)) {
          const element = textLayerEl.querySelector(`[data-id="${item.id}"]`);
          if (element) {
            textMgrInstance.selectedBlocks.push({ element, item });
            element.classList.add('selected-by-lasso');
          }
        }
      });
    });

    canvasEl.addEventListener('selection-moved', (e) => {
      const { dx, dy } = e.detail;
      const textMgrInstance = textManagers[pageNum];
      if (!textMgrInstance || !textMgrInstance.selectedBlocks || textMgrInstance.selectedBlocks.length === 0) return;

      textMgrInstance.selectedBlocks.forEach(({ element, item }) => {
        item.x += dx * 100;
        item.y += dy * 100;
        element.style.left = `${item.x}%`;
        element.style.top = `${item.y}%`;
      });
      textMgrInstance.onSave(textMgrInstance.getTexts());
    });

    canvasEl.addEventListener('selection-scaled', (e) => {
      const { scale, cx, cy } = e.detail;
      const textMgrInstance = textManagers[pageNum];
      if (!textMgrInstance || !textMgrInstance.selectedBlocks || textMgrInstance.selectedBlocks.length === 0) return;

      textMgrInstance.selectedBlocks.forEach(({ element, item }) => {
        const tx = (item.x + (item.width || 40) / 2) / 100;
        const ty = (item.y + (item.height || 25) / 2) / 100;

        const newTx = cx + (tx - cx) * scale;
        const newTy = cy + (ty - cy) * scale;

        item.width = (item.width || 40) * scale;
        item.height = (item.height || 25) * scale;

        item.x = newTx * 100 - item.width / 2;
        item.y = newTy * 100 - item.height / 2;

        element.style.left = `${item.x}%`;
        element.style.top = `${item.y}%`;
        element.style.width = `${item.width}%`;
        element.style.height = `${item.height}%`;
      });
      textMgrInstance.onSave(textMgrInstance.getTexts());
    });

    canvasEl.addEventListener('selection-rotated', (e) => {
      const { angle, cx, cy } = e.detail;
      const textMgrInstance = textManagers[pageNum];
      if (!textMgrInstance || !textMgrInstance.selectedBlocks || textMgrInstance.selectedBlocks.length === 0) return;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      textMgrInstance.selectedBlocks.forEach(({ element, item }) => {
        const tx = (item.x + (item.width || 40) / 2) / 100;
        const ty = (item.y + (item.height || 25) / 2) / 100;

        const rx = tx - cx;
        const ry = ty - cy;

        const newTx = cx + (rx * cos - ry * sin);
        const newTy = cy + (rx * sin + ry * cos);

        item.x = newTx * 100 - (item.width || 40) / 2;
        item.y = newTy * 100 - (item.height || 25) / 2;

        item.rotation = (item.rotation || 0) + angle * 180 / Math.PI;

        element.style.left = `${item.x}%`;
        element.style.top = `${item.y}%`;
        element.style.transform = `rotate(${item.rotation}deg)`;
      });
      textMgrInstance.onSave(textMgrInstance.getTexts());
    });

    canvasEl.addEventListener('selection-cleared', () => {
      const fillSelectionBtn = document.getElementById('fill-selection-btn');
      if (fillSelectionBtn) {
        fillSelectionBtn.style.display = 'none';
      }

      const textMgrInstance = textManagers[pageNum];
      if (!textMgrInstance) return;

      if (textMgrInstance.selectedBlocks) {
        textMgrInstance.selectedBlocks.forEach(({ element }) => {
          element.classList.remove('selected-by-lasso');
        });
        textMgrInstance.selectedBlocks = [];
      }
    });
  }

  // Resize visible page canvases immediately after initialization
  const currentPages = book ? book.getCurrentPages() : null;
  if (currentPages) {
    if (currentPages.left && canvasManagers[currentPages.left]) {
      canvasManagers[currentPages.left].resizeCanvas();
    }
    if (currentPages.right && canvasManagers[currentPages.right]) {
      canvasManagers[currentPages.right].resizeCanvas();
    }
  }
}

// Autosave function trigger
function handlePageSave(pageNum, drawings, texts) {
  db.savePage(pageNum, drawings, texts);
}

// Listen to page flips to update toolbar, sharing options, and Realtime sync
function handleBookPageChange(state) {
  // Update footer page text
  const indicator = document.getElementById('page-indicator');
  indicator.innerText = state.label;

  // Toggle arrow buttons accessibility
  document.getElementById('prev-page-btn').disabled = state.type === 'cover';
  document.getElementById('next-page-btn').disabled = state.type === 'backcover';

  // Handle sidebar toolbar visibility
  const sidebar = document.getElementById('editor-tools');
  const shareBox = sidebar.querySelector('.share-box');
  
  if (state.type === 'cover' || state.type === 'backcover') {
    // Force Browse mode when on cover or backcover
    document.body.classList.remove('mode-text', 'mode-draw');
    document.body.classList.add('mode-browse');

    document.querySelectorAll('.tool-btn, .color-dot, #brush-size, #clear-page-btn').forEach(el => {
      el.disabled = true;
      el.classList.remove('active');
    });

    const browseBtn = document.getElementById('tool-browse');
    if (browseBtn) {
      browseBtn.classList.add('active');
      browseBtn.disabled = false;
    }

    shareBox.classList.add('hidden');
  } else {
    // Enable all tools when moving to content pages
    document.querySelectorAll('.tool-btn, .color-dot, #brush-size, #clear-page-btn').forEach(el => {
      el.disabled = false;
    });

    // Make sure the active button in HTML matches the body class
    const activeBtn = document.querySelector(`.tool-btn.active`);
    if (!activeBtn) {
      // Fallback: make Browse mode active by default
      document.body.classList.remove('mode-text', 'mode-draw');
      document.body.classList.add('mode-browse');
      const browseBtn = document.getElementById('tool-browse');
      if (browseBtn) browseBtn.classList.add('active');
    }

    shareBox.classList.remove('hidden');
    
    // Dynamic page sharing selector updates
    updateShareSelector(state.left, state.right);
  }

  // Manage Supabase Realtime channel bindings based on visible pages
  manageRealtimeSubscriptions(state);

  // Resize visible canvases to ensure they have correct dimensions after layout
  if (state.left && canvasManagers[state.left]) {
    canvasManagers[state.left].resizeCanvas();
  }
  if (state.right && canvasManagers[state.right]) {
    canvasManagers[state.right].resizeCanvas();
  }

  // Refresh layers list on page change
  renderLayersList();
}

// Update the dynamic sharing selector options based on visible pages L/R
function updateShareSelector(leftPageNum, rightPageNum) {
  const shareBox = document.querySelector('.share-box');
  
  // Remove existing dropdown if any
  let selectContainer = shareBox.querySelector('.share-page-selector');
  if (selectContainer) selectContainer.remove();

  // Create selector HTML
  selectContainer = document.createElement('div');
  selectContainer.className = 'share-page-selector';
  selectContainer.style.marginBottom = '12px';
  selectContainer.style.display = 'flex';
  selectContainer.style.flexDirection = 'column';
  selectContainer.style.gap = '6px';

  const label = document.createElement('span');
  label.style.fontSize = '12px';
  label.style.color = '#9ca3af';
  label.innerText = '選擇設定分享的頁面：';

  const select = document.createElement('select');
  select.id = 'share-page-select';
  select.style.width = '100%';
  select.style.background = 'rgba(0, 0, 0, 0.25)';
  select.style.border = '1px solid var(--color-panel-border)';
  select.style.color = 'white';
  select.style.padding = '8px';
  select.style.borderRadius = '6px';
  select.style.outline = 'none';

  select.innerHTML = `
    <option value="${leftPageNum}">第 ${leftPageNum} 頁 (左頁)</option>
    <option value="${rightPageNum}">第 ${rightPageNum} 頁 (右頁)</option>
  `;

  selectContainer.appendChild(label);
  selectContainer.appendChild(select);
  
  // Insert inside share-box before header
  shareBox.insertBefore(selectContainer, shareBox.firstChild);

  // Set initial selected option and configure click events
  currentActiveSharePage = leftPageNum;
  loadPageShareState(leftPageNum);

  select.addEventListener('change', (e) => {
    currentActiveSharePage = parseInt(e.target.value, 10);
    loadPageShareState(currentActiveSharePage);
  });
}

// Read share status for page and sync toggle UI
async function loadPageShareState(pageNum) {
  const pageData = await db.loadPage(pageNum);
  const toggle = document.getElementById('share-toggle');
  const urlContainer = document.getElementById('share-url-container');
  const urlInput = document.getElementById('share-url-input');

  toggle.checked = pageData.is_shared;

  if (pageData.is_shared) {
    urlContainer.classList.remove('hidden');
    urlInput.value = generateShareLink(pageNum);
  } else {
    urlContainer.classList.add('hidden');
  }
}

// Generate shared url format
function generateShareLink(pageNum) {
  const pageId = `page_${pageNum}`;
  // Use hash routing: e.g. https://domain.com/#/share/page_2
  return `${window.location.origin}${window.location.pathname}#/share/${pageId}`;
}

// Manage database Realtime listeners to keep visible pages synchronized
function manageRealtimeSubscriptions(state) {
  if (!db.isConnected()) return;

  db.unsubscribeRealtime();

  if (state.type === 'spread') {
    // Synchronize Left Page
    db.subscribeRealtime(state.left, (newData) => {
      syncPageDataFromCloud(state.left, newData);
    });

    // Synchronize Right Page
    db.subscribeRealtime(state.right, (newData) => {
      syncPageDataFromCloud(state.right, newData);
    });
  }
}

// Load updated canvas & text block states from cloud database updates
function syncPageDataFromCloud(pageNum, newData) {
  const canvasMgr = canvasManagers[pageNum];
  const textMgr = textManagers[pageNum];

  if (canvasMgr) {
    // Only reload drawings if not currently editing/drawing by user
    if (!canvasMgr.isDrawing) {
      canvasMgr.loadPaths(newData.drawings);
    }
  }

  if (textMgr) {
    // Sync text only if user is not currently dragging/typing inside text block
    const isEditingAny = textMgr.container.querySelector('.text-block.editing') !== null;
    if (!textMgr.draggedBlock && !isEditingAny) {
      textMgr.loadTexts(newData.texts);
    }
  }
}

/* =========================================================================
   TOOLBAR & SETTINGS UI EVENTS
   ========================================================================= */

function setupToolbarEvents() {
  // Initialize default mode
  document.body.classList.add('mode-browse');

  const browseBtn = document.getElementById('tool-browse');
  const textBtn = document.getElementById('tool-text');
  const penBtn = document.getElementById('tool-pen');
  const eraserBtn = document.getElementById('tool-eraser');
  const lassoBtn = document.getElementById('tool-lasso');
  const bucketBtn = document.getElementById('tool-bucket');

  const sidebarEl = document.getElementById('editor-tools');

  const clearButtonStates = () => {
    browseBtn.classList.remove('active');
    textBtn.classList.remove('active');
    penBtn.classList.remove('active');
    eraserBtn.classList.remove('active');
    if (lassoBtn) lassoBtn.classList.remove('active');
    if (bucketBtn) bucketBtn.classList.remove('active');
  };

  const updateQuickButtonsHighlight = (activeId) => {
    const ids = ['quick-tool-browse', 'quick-tool-text', 'quick-tool-pen', 'quick-tool-eraser', 'quick-tool-lasso', 'quick-tool-bucket'];
    ids.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        if (id === activeId) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
  };

  const setMode = (modeName) => {
    document.body.classList.remove('mode-browse', 'mode-text', 'mode-draw');
    document.body.classList.add(`mode-${modeName}`);

    // Toggle global input overlay canvas
    const globalInputContainer = document.getElementById('global-input-container');
    const globalInputCanvas = document.getElementById('global-input-canvas');
    if (globalInputContainer && globalInputCanvas) {
      if (modeName === 'draw') {
        globalInputContainer.style.display = 'block';
        globalInputCanvas.width = window.innerWidth;
        globalInputCanvas.height = window.innerHeight;
        
        // Resize active page canvases when entering drawing mode to ensure correct resolutions
        const currentPages = book ? book.getCurrentPages() : null;
        if (currentPages) {
          if (currentPages.left && canvasManagers[currentPages.left]) {
            canvasManagers[currentPages.left].resizeCanvas();
          }
          if (currentPages.right && canvasManagers[currentPages.right]) {
            canvasManagers[currentPages.right].resizeCanvas();
          }
        }
      } else {
        globalInputContainer.style.display = 'none';
      }
    }

    // Manage active tool button classes synchronously to prevent event race fallbacks
    if (modeName === 'browse') {
      clearButtonStates();
      browseBtn.classList.add('active');
      updateQuickButtonsHighlight('quick-tool-browse');
    } else if (modeName === 'text') {
      clearButtonStates();
      textBtn.classList.add('active');
      updateQuickButtonsHighlight('quick-tool-text');
    } else if (modeName === 'draw') {
      // Handled individually by click handlers
    }

    // Auto-close sidebar on mobile/tablet screen widths (including landscape iPad Pro up to 1366px)
    const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
    if (sidebarEl && (window.innerWidth <= 1366 || isIPad)) {
      sidebarEl.classList.remove('active');
    }

    // Auto layout switching based on editing vs browsing state has been disabled
    // to prevent unexpected page jumps and allow editing in double-page layout mode.
    if (typeof syncSketchbookToolbarHighlights === 'function') {
      syncSketchbookToolbarHighlights();
    }
  };

  browseBtn.addEventListener('click', () => {
    setMode('browse');
  });

  textBtn.addEventListener('click', () => {
    setMode('text');
  });

  penBtn.addEventListener('click', () => {
    clearButtonStates();
    penBtn.classList.add('active');
    updateQuickButtonsHighlight('quick-tool-pen');
    setMode('draw');
    updateAllCanvasBrushes(mgr => {
      mgr.setLassoMode(false);
      mgr.setFillMode(false);
      mgr.setEraserMode(false);
    });
    if (typeof syncSketchbookToolbarHighlights === 'function') {
      syncSketchbookToolbarHighlights();
    }
  });

  eraserBtn.addEventListener('click', () => {
    clearButtonStates();
    eraserBtn.classList.add('active');
    updateQuickButtonsHighlight('quick-tool-eraser');
    setMode('draw');
    updateAllCanvasBrushes(mgr => {
      mgr.setLassoMode(false);
      mgr.setFillMode(false);
      mgr.setEraserMode(true);
    });
    if (typeof syncSketchbookToolbarHighlights === 'function') {
      syncSketchbookToolbarHighlights();
    }
  });

  if (lassoBtn) {
    lassoBtn.addEventListener('click', () => {
      clearButtonStates();
      lassoBtn.classList.add('active');
      updateQuickButtonsHighlight('quick-tool-lasso');
      setMode('draw');
      updateAllCanvasBrushes(mgr => {
        mgr.setEraserMode(false);
        mgr.setFillMode(false);
        mgr.setLassoMode(true);
      });
      if (typeof syncSketchbookToolbarHighlights === 'function') {
        syncSketchbookToolbarHighlights();
      }
    });
  }

  if (bucketBtn) {
    bucketBtn.addEventListener('click', () => {
      clearButtonStates();
      bucketBtn.classList.add('active');
      updateQuickButtonsHighlight('quick-tool-bucket');
      setMode('draw');
      updateAllCanvasBrushes(mgr => {
        mgr.setEraserMode(false);
        mgr.setLassoMode(false);
        mgr.setFillMode(true);
      });
      if (typeof syncSketchbookToolbarHighlights === 'function') {
        syncSketchbookToolbarHighlights();
      }
    });
  }

  const fillSelectionBtn = document.getElementById('fill-selection-btn');
  if (fillSelectionBtn) {
    fillSelectionBtn.addEventListener('click', () => {
      let activeColor = '#1e1e1e';
      const activeDot = document.querySelector('.color-dot.active');
      if (activeDot) {
        activeColor = activeDot.dataset.color;
      } else {
        const customInput = document.getElementById('custom-brush-color');
        if (customInput) activeColor = customInput.value;
      }

      let targetPageNum = null;
      for (const pageNum of EDITABLE_PAGES) {
        const mgr = canvasManagers[pageNum];
        if (mgr && mgr.lastLassoPoints && mgr.lastLassoPoints.length > 2) {
          targetPageNum = pageNum;
          break;
        }
      }

      if (targetPageNum && canvasManagers[targetPageNum]) {
        canvasManagers[targetPageNum].fillSelection(activeColor);
      }
    });
  }

  // --- Floating Quick-Toolbar Event Binding ---
  const bindQuickBtn = (quickId, sidebarBtn) => {
    const qBtn = document.getElementById(quickId);
    if (qBtn && sidebarBtn) {
      qBtn.addEventListener('click', () => {
        sidebarBtn.click();
        updateQuickButtonsHighlight(quickId);
      });
    }
  };

  bindQuickBtn('quick-tool-browse', browseBtn);
  bindQuickBtn('quick-tool-text', textBtn);
  bindQuickBtn('quick-tool-pen', penBtn);
  bindQuickBtn('quick-tool-eraser', eraserBtn);
  bindQuickBtn('quick-tool-lasso', lassoBtn);
  bindQuickBtn('quick-tool-bucket', bucketBtn);

  // Quick toolbar color selector dots
  document.querySelectorAll('.quick-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      // Highlight selection in quick toolbar
      document.querySelectorAll('.quick-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');

      const color = dot.dataset.color;
      if (color) {
        // Find corresponding sidebar color dot and click it!
        const sidebarDot = document.querySelector(`.color-dot[data-color="${color}"]`);
        if (sidebarDot) {
          sidebarDot.click();
        }
      }
    });
  });

  const quickRainbow = document.getElementById('quick-rainbow');
  const customColorInputWheel = document.getElementById('custom-brush-color');
  if (quickRainbow && customColorInputWheel) {
    quickRainbow.addEventListener('click', () => {
      document.querySelectorAll('.quick-color-dot').forEach(d => d.classList.remove('active'));
      quickRainbow.classList.add('active');
      customColorInputWheel.click();
    });
  }

  // Quick Toolbar Undo & Redo buttons
  const quickUndoBtn = document.getElementById('quick-undo');
  const quickRedoBtn = document.getElementById('quick-redo');

  const getActiveCanvasManager = () => {
    let pageNum = book.activePageNum;
    if (book.layoutMode === 'double') {
      pageNum = book.getCurrentPages().left || book.getCurrentPages().right || 1;
    }
    return canvasManagers[pageNum];
  };

  if (quickUndoBtn) {
    quickUndoBtn.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) mgr.undo();
    });
  }

  if (quickRedoBtn) {
    quickRedoBtn.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) mgr.redo();
    });
  }

  // Quick Toolbar Layers button to toggle layers panel
  const quickLayersBtn = document.getElementById('quick-tool-layers');
  const quickLayersPanel = document.getElementById('quick-layers-panel');
  if (quickLayersBtn && quickLayersPanel) {
    quickLayersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = quickLayersPanel.style.display === 'none';
      quickLayersPanel.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        quickLayersBtn.classList.add('active');
        renderLayersList();
        if (window.lucide) window.lucide.createIcons();
      } else {
        quickLayersBtn.classList.remove('active');
      }
    });

    // Close panel on clicking outside
    document.addEventListener('click', (e) => {
      if (!quickLayersPanel.contains(e.target) && e.target !== quickLayersBtn && !e.target.closest('.layer-action-btn') && !e.target.closest('.quick-panel-btn')) {
        quickLayersPanel.style.display = 'none';
        quickLayersBtn.classList.remove('active');
      }
    });
  }

  const addLayerBtn = document.getElementById('add-layer-btn');
  if (addLayerBtn) {
    addLayerBtn.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) {
        const layerCount = mgr.layers.filter(l => l.id !== 'text-media').length + 1;
        const name = prompt('請輸入新圖層名稱:', `圖層 ${layerCount}`);
        if (name) {
          const newLayer = {
            id: 'layer_' + Math.random().toString(36).substr(2, 9),
            name: name,
            visible: true,
            locked: false
          };
          const textMediaIdx = mgr.layers.findIndex(l => l.id === 'text-media');
          if (textMediaIdx !== -1) {
            mgr.layers.splice(textMediaIdx, 0, newLayer);
          } else {
            mgr.layers.push(newLayer);
          }
          mgr.activeLayerId = newLayer.id;
          mgr.onSave(mgr.getPaths());
          renderLayersList();
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });
  }

  // 2. Color dots picker (including Custom Color Picker Wheel)
  const customColorInput = document.getElementById('custom-brush-color');
  const customColorWrapper = document.getElementById('custom-color-picker-wrapper');

  if (customColorInput) {
    const handleCustomColor = (e) => {
      const color = e.target.value;
      
      // Select the custom picker wrapper styling
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      if (customColorWrapper) {
        customColorWrapper.style.borderColor = 'var(--color-primary)';
        customColorWrapper.style.transform = 'scale(1.15)';
      }

      // Auto switch to Draw Mode on color selected
      setMode('draw');
      penBtn.classList.add('active');
      updateAllCanvasBrushes(mgr => {
        mgr.setEraserMode(false);
        mgr.setBrushColor(color);
      });
    };

    customColorInput.addEventListener('input', handleCustomColor);
    customColorInput.addEventListener('change', handleCustomColor);
  }

  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      
      // Reset custom picker border
      if (customColorWrapper) {
        customColorWrapper.style.borderColor = 'rgba(255,255,255,0.15)';
        customColorWrapper.style.transform = 'scale(1)';
      }
      
      const color = dot.dataset.color;

      // Auto switch to Draw Mode on color selected
      setMode('draw');
      penBtn.classList.add('active');
      updateAllCanvasBrushes(mgr => {
        mgr.setEraserMode(false);
        mgr.setBrushColor(color);
      });
    });
  });

  // 3. Brush Size slider
  const sizeSlider = document.getElementById('brush-size');
  const sizeVal = document.getElementById('brush-size-val');
  sizeSlider.addEventListener('input', (e) => {
    const size = e.target.value;
    sizeVal.innerText = `${size}px`;
    updateAllCanvasBrushes(mgr => mgr.setBrushSize(size));
  });

  // Handle Media file upload logic
  async function handleMediaUpload(file) {
    if (!file) return;

    const fileType = file.type;
    const isImage = fileType.startsWith('image/');
    const isVideo = fileType.startsWith('video/');

    if (!isImage && !isVideo) {
      alert('不支援此檔案類型！僅支援圖片與影片。');
      return;
    }

    // Check size limit for local storage mode
    if (!db.isConnected() && file.size > 1.5 * 1024 * 1024) {
      if (!confirm('警告：目前處於本地儲存模式，大檔案（大於 1.5MB）可能會超出瀏覽器儲存上限。是否仍要上傳？')) {
        return;
      }
    }

    const originalHTML = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '<i data-lucide="loader-2" class="spinning-icon" style="animation: spin 1s linear infinite;"></i><span>上傳中...</span>';
    uploadBtn.disabled = true;
    if (window.lucide) window.lucide.createIcons();

    try {
      let mediaUrl = null;
      if (db.isConnected()) {
        mediaUrl = await db.uploadMedia(file);
      }

      if (!mediaUrl) {
        mediaUrl = await convertFileToBase64(file);
      }

      let targetPage = currentActiveSharePage;
      if (!targetPage) {
        const currentPages = book.getCurrentPages();
        targetPage = currentPages.left;
      }

      if (targetPage && textManagers[targetPage]) {
        const type = isImage ? 'image' : 'video';
        textManagers[targetPage].addMediaBlock(type, mediaUrl);
      } else {
        alert('無法找到當前編輯的頁面，請確認您已翻至內頁！');
      }
    } catch (err) {
      console.error(err);
      alert(`上傳失敗: ${err.message}`);
    } finally {
      uploadBtn.innerHTML = originalHTML;
      uploadBtn.disabled = false;
      fileInput.value = '';
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // Upload Image/Video Button Events
  const uploadBtn = document.getElementById('upload-media-btn');
  const fileInput = document.getElementById('media-file-input');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      const currentPages = book.getCurrentPages();
      if (currentPages.type !== 'spread') {
        alert('請先翻頁到筆記內頁再上傳多媒體！');
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      await handleMediaUpload(file);
    });
  }

  // Drag & Drop iPadOS Multitasking support (Procreate, Files, etc.)
  const workspace = document.querySelector('.workspace');
  if (workspace) {
    workspace.addEventListener('dragover', (e) => {
      e.preventDefault();
      workspace.classList.add('drag-active');
    });

    workspace.addEventListener('dragleave', () => {
      workspace.classList.remove('drag-active');
    });

    workspace.addEventListener('drop', async (e) => {
      e.preventDefault();
      workspace.classList.remove('drag-active');
      
      const currentPages = book.getCurrentPages();
      if (currentPages.type !== 'spread') {
        alert('請先翻頁到筆記內頁再拖曳放置媒體！');
        return;
      }

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await handleMediaUpload(files[0]);
      }
    });
  }

  // 4. Clear Page with Select Modal Support
  const clearModal = document.getElementById('clear-modal');
  const clearLeftBtn = document.getElementById('clear-left-btn');
  const clearRightBtn = document.getElementById('clear-right-btn');
  const clearBothBtn = document.getElementById('clear-both-btn');
  const clearCancelBtn = document.getElementById('clear-cancel-btn');

  const performClearPage = (pageNum) => {
    if (canvasManagers[pageNum]) canvasManagers[pageNum].clear();
    if (textManagers[pageNum]) textManagers[pageNum].clear();
  };

  document.getElementById('clear-page-btn').addEventListener('click', () => {
    const currentPages = book.getCurrentPages();
    
    // Cover & Backcover are read-only, should not be cleared
    if (currentPages.type === 'cover' || currentPages.type === 'backcover') {
      alert('封面與封底無法清空！');
      return;
    }

    // Single Page Mode: clear the active page directly after standard confirmation
    if (book.layoutMode === 'single') {
      const activePage = book.activePageNum;
      if (confirm(`您確定要清空第 ${activePage} 頁的所有內容嗎？（此動作無法還原）`)) {
        performClearPage(activePage);
      }
      return;
    }

    // Double Page Mode: show clear options modal
    if (currentPages.type === 'spread') {
      const leftPage = currentPages.left;
      const rightPage = currentPages.right;

      // Update button labels dynamically with page numbers
      if (clearLeftBtn) clearLeftBtn.innerText = `清除左頁 (第 ${leftPage} 頁)`;
      if (clearRightBtn) clearRightBtn.innerText = `清除右頁 (第 ${rightPage} 頁)`;

      // Show the modal
      if (clearModal) clearModal.classList.remove('hidden');

      // Click Handlers for options
      const handleClearLeft = () => {
        if (confirm(`確定要清空第 ${leftPage} 頁的內容嗎？`)) {
          performClearPage(leftPage);
        }
        closeClearModal();
      };
      
      const handleClearRight = () => {
        if (confirm(`確定要清空第 ${rightPage} 頁的內容嗎？`)) {
          performClearPage(rightPage);
        }
        closeClearModal();
      };

      const handleClearBoth = () => {
        if (confirm(`確定要同時清空第 ${leftPage} 頁與第 ${rightPage} 頁的內容嗎？`)) {
          performClearPage(leftPage);
          performClearPage(rightPage);
        }
        closeClearModal();
      };

      const closeClearModal = () => {
        if (clearModal) clearModal.classList.add('hidden');
        // Clean up temporary listeners to avoid accumulation!
        clearLeftBtn.removeEventListener('click', handleClearLeft);
        clearRightBtn.removeEventListener('click', handleClearRight);
        clearBothBtn.removeEventListener('click', handleClearBoth);
        clearCancelBtn.removeEventListener('click', closeClearModal);
      };

      // Add temporary listener bindings
      clearLeftBtn.addEventListener('click', handleClearLeft);
      clearRightBtn.addEventListener('click', handleClearRight);
      clearBothBtn.addEventListener('click', handleClearBoth);
      clearCancelBtn.addEventListener('click', closeClearModal);
    }
  });

  // 5. Sharing Switch Toggle
  const shareToggle = document.getElementById('share-toggle');
  shareToggle.addEventListener('change', async (e) => {
    if (!currentActiveSharePage) return;
    
    const isShared = e.target.checked;
    
    try {
      await db.toggleShare(currentActiveSharePage, isShared);
      loadPageShareState(currentActiveSharePage);
    } catch (err) {
      alert(`分享設定失敗: ${err.message}`);
      shareToggle.checked = !isShared;
    }
  });

  // 6. Copy Link button
  document.getElementById('copy-share-btn').addEventListener('click', () => {
    const urlInput = document.getElementById('share-url-input');
    urlInput.select();
    urlInput.setSelectionRange(0, 99999);
    
    try {
      navigator.clipboard.writeText(urlInput.value);
      
      // Visual Feedback
      const copyIcon = document.querySelector('#copy-share-btn i');
      copyIcon.setAttribute('data-lucide', 'check');
      if (window.lucide) window.lucide.createIcons();
      setTimeout(() => {
        copyIcon.setAttribute('data-lucide', 'copy');
        if (window.lucide) window.lucide.createIcons();
      }, 1500);
    } catch (err) {
      alert('複製失敗，請手動選取複製');
    }
  });

  // 7. Zoom Controls
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomResetBtn = document.getElementById('zoom-reset-btn');

  if (zoomInBtn && zoomOutBtn && zoomResetBtn) {
    zoomInBtn.addEventListener('click', () => {
      if (book) book.zoomIn();
    });
    zoomOutBtn.addEventListener('click', () => {
      if (book) book.zoomOut();
    });
    zoomResetBtn.addEventListener('click', () => {
      if (book) book.zoomReset();
    });
  }
}

function updateAllCanvasBrushes(callback) {
  for (const pageNum in canvasManagers) {
    callback(canvasManagers[pageNum]);
  }
}

/* =========================================================================
   DATABASE SYNC SETUP DIALOG
   ========================================================================= */

function setupDbConnectionUI() {
  const dbStatusBtn = document.getElementById('db-status-btn');
  const dbModal = document.getElementById('db-modal');
  const form = document.getElementById('db-config-form');
  const disconnectBtn = document.getElementById('disconnect-db-btn');
  
  const sbUrlInput = document.getElementById('sb-url');
  const sbKeyInput = document.getElementById('sb-key');

  const updateBadge = () => {
    const isConnected = db.isConnected();
    if (isConnected) {
      dbStatusBtn.className = 'status-btn online';
      dbStatusBtn.innerHTML = '<i data-lucide="cloud"></i><span>雲端已同步</span>';
      disconnectBtn.classList.remove('hidden');
      
      // Prefill fields
      const cfg = db.getDbConfig();
      if (cfg) {
        sbUrlInput.value = cfg.url;
        sbKeyInput.value = cfg.key;
      }
    } else {
      dbStatusBtn.className = 'status-btn offline';
      dbStatusBtn.innerHTML = '<i data-lucide="cloud-off"></i><span>本地儲存模式</span>';
      disconnectBtn.classList.add('hidden');
      
      sbUrlInput.value = '';
      sbKeyInput.value = '';
    }
    if (window.lucide) window.lucide.createIcons();
  };

  // Run on start
  updateBadge();

  // Handle connection submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = sbUrlInput.value.trim();
    const key = sbKeyInput.value.trim();

    const saveBtn = form.querySelector('button[type="submit"]');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '連接中...';
    saveBtn.disabled = true;

    try {
      await db.connectCloud(url, key);
      updateBadge();
      
      // Close modal
      dbModal.classList.add('hidden');
      
      // Refresh layers with cloud content
      await preloadPagesAndInitializeLayers();
      
      // Update realtime listeners for currently open sheets
      if (book) {
        manageRealtimeSubscriptions(book.getCurrentPages());
      }
      
      alert('Supabase 雲端資料庫連接成功！資料已完成同步。');
    } catch (err) {
      alert(err.message);
    } finally {
      saveBtn.innerText = originalText;
      saveBtn.disabled = false;
    }
  });

  // Handle disconnect
  disconnectBtn.addEventListener('click', () => {
    if (!confirm('確定要斷開 Supabase 雲端連結嗎？這會讓筆記本回到本地儲存模式。')) return;
    
    db.disconnectCloud();
    updateBadge();
    dbModal.classList.add('hidden');
    
    alert('已成功中斷雲端連結。本機修改將不再同步。');
  });

  // Copy SQL tutorial code helper
  document.getElementById('copy-sql-btn').addEventListener('click', () => {
    const text = document.getElementById('sql-syntax').innerText;
    navigator.clipboard.writeText(text).then(() => {
      alert('SQL 語法已複製至剪貼簿！');
    });
  });
}

/* =========================================================================
   MODALS UTILITY HELPERS
   ========================================================================= */

function setupModal(triggerBtnId, modalId) {
  const trigger = document.getElementById(triggerBtnId);
  const modal = document.getElementById(modalId);
  
  if (!trigger || !modal) return;

  trigger.addEventListener('click', () => {
    modal.classList.remove('hidden');
  });

  // Setup click triggers on all close selectors
  modal.querySelectorAll('[data-close]').forEach(closer => {
    closer.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  });

  // Close when clicked overlay background
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
}

function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function syncTextMediaDOM(pageNum, layers) {
  const textMgrInstance = textManagers[pageNum];
  const textLayerEl = textMgrInstance ? textMgrInstance.container : document.getElementById(`text-layer-${pageNum}`);
  const canvasEl = document.getElementById(`canvas-${pageNum}`);
  
  if (textLayerEl && canvasEl) {
    const textMediaLayer = layers.find(l => l.id === 'text-media');
    if (textMediaLayer) {
      textLayerEl.style.display = textMediaLayer.visible ? 'block' : 'none';
      textLayerEl.style.pointerEvents = textMediaLayer.locked ? 'none' : 'auto';
    }

    // Dynamic Z-Index Swap based on layers hierarchy order
    const textMediaIdx = layers.findIndex(l => l.id === 'text-media');
    let maxVisibleDrawIdx = -1;
    layers.forEach((l, idx) => {
      if (l.id !== 'text-media' && l.visible) {
        if (idx > maxVisibleDrawIdx) {
          maxVisibleDrawIdx = idx;
        }
      }
    });

    if (textMediaIdx > maxVisibleDrawIdx) {
      // Text layer on top of Canvas drawing layer
      textLayerEl.style.zIndex = '20';
      canvasEl.style.zIndex = '10';
    } else {
      // Canvas drawing layer on top of Text layer
      textLayerEl.style.zIndex = '10';
      canvasEl.style.zIndex = '20';
    }
  }
}

function renderLayersList() {
  const getActiveCanvasManager = () => {
    if (!book) return null;
    let pageNum = book.activePageNum;
    if (book.layoutMode === 'double') {
      pageNum = book.getCurrentPages().left || book.getCurrentPages().right || 1;
    }
    return canvasManagers[pageNum];
  };

  const mgr = getActiveCanvasManager();
  const container = document.getElementById('sk-layers-container');
  if (!mgr || !container) return;

  container.innerHTML = '';

  let targetPageNum = null;
  for (const pageNum of EDITABLE_PAGES) {
    if (canvasManagers[pageNum] === mgr) {
      targetPageNum = pageNum;
      break;
    }
  }

  // Render layers in reverse z-index order (top z-index first)
  for (let i = mgr.layers.length - 1; i >= 0; i--) {
    const layer = mgr.layers[i];
    const isActive = mgr.activeLayerId === layer.id;

    // Create Autodesk Sketchbook Layer Card
    const cardEl = document.createElement('div');
    cardEl.className = `sk-layer-card ${isActive ? 'active' : ''}`;
    cardEl.title = `${layer.name}${layer.locked ? ' (鎖定)' : ''}${!layer.visible ? ' (隱藏)' : ''}`;

    const labelEl = document.createElement('span');
    labelEl.className = 'sk-layer-label';
    labelEl.innerText = `${i + 1}`;
    cardEl.appendChild(labelEl);

    // Contextual Options Toolbar (flips left next to the card)
    const optionsEl = document.createElement('div');
    optionsEl.className = 'sk-layer-options';
    optionsEl.style.display = 'none';

    // 1. Move Up button
    if (i < mgr.layers.length - 1) {
      const upBtn = document.createElement('button');
      upBtn.className = 'layer-action-btn';
      upBtn.innerHTML = '<i data-lucide="arrow-up" style="width:13px;height:13px;"></i>';
      upBtn.title = '上移圖層';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const temp = mgr.layers[i];
        mgr.layers[i] = mgr.layers[i + 1];
        mgr.layers[i + 1] = temp;
        if (targetPageNum) syncTextMediaDOM(targetPageNum, mgr.layers);
        mgr.drawAll();
        mgr.onSave(mgr.getPaths());
        renderLayersList();
        if (window.lucide) window.lucide.createIcons();
      });
      optionsEl.appendChild(upBtn);
    }

    // 2. Move Down button
    if (i > 0) {
      const downBtn = document.createElement('button');
      downBtn.className = 'layer-action-btn';
      downBtn.innerHTML = '<i data-lucide="arrow-down" style="width:13px;height:13px;"></i>';
      downBtn.title = '下移圖層';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const temp = mgr.layers[i];
        mgr.layers[i] = mgr.layers[i - 1];
        mgr.layers[i - 1] = temp;
        if (targetPageNum) syncTextMediaDOM(targetPageNum, mgr.layers);
        mgr.drawAll();
        mgr.onSave(mgr.getPaths());
        renderLayersList();
        if (window.lucide) window.lucide.createIcons();
      });
      optionsEl.appendChild(downBtn);
    }

    // 3. Eye Button (Visibility)
    const eyeBtn = document.createElement('button');
    eyeBtn.className = `layer-action-btn ${layer.visible ? 'active' : ''}`;
    eyeBtn.innerHTML = `<i data-lucide="${layer.visible ? 'eye' : 'eye-off'}" style="width:13px;height:13px;"></i>`;
    eyeBtn.title = layer.visible ? '隱藏圖層' : '顯示圖層';
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      if (layer.id === 'text-media' && targetPageNum) {
        syncTextMediaDOM(targetPageNum, mgr.layers);
      }
      mgr.drawAll();
      mgr.onSave(mgr.getPaths());
      renderLayersList();
      if (window.lucide) window.lucide.createIcons();
    });
    optionsEl.appendChild(eyeBtn);

    // 4. Lock Button (Security)
    const lockBtn = document.createElement('button');
    lockBtn.className = `layer-action-btn ${layer.locked ? 'active' : ''}`;
    lockBtn.innerHTML = `<i data-lucide="${layer.locked ? 'lock' : 'unlock'}" style="width:13px;height:13px;"></i>`;
    lockBtn.title = layer.locked ? '解鎖圖層' : '鎖定圖層';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      if (layer.id === 'text-media' && targetPageNum) {
        syncTextMediaDOM(targetPageNum, mgr.layers);
      }
      mgr.drawAll();
      mgr.onSave(mgr.getPaths());
      renderLayersList();
      if (window.lucide) window.lucide.createIcons();
    });
    optionsEl.appendChild(lockBtn);

    // 5. Delete Button (Custom Layers only)
    if (layer.id !== 'default' && layer.id !== 'text-media') {
      const delBtn = document.createElement('button');
      delBtn.className = 'layer-action-btn';
      delBtn.style.color = '#ef4444';
      delBtn.innerHTML = '<i data-lucide="trash-2" style="width:13px;height:13px;"></i>';
      delBtn.title = '刪除圖層';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`確認要刪除圖層 "${layer.name}" 嗎？該圖層的所有手繪筆跡都將被永久刪除。`)) {
          mgr.paths = mgr.paths.filter(p => p.layerId !== layer.id);
          mgr.layers = mgr.layers.filter(l => l.id !== layer.id);
          if (mgr.activeLayerId === layer.id) {
            mgr.activeLayerId = 'default';
          }
          mgr.drawAll();
          mgr.onSave(mgr.getPaths());
          renderLayersList();
          if (window.lucide) window.lucide.createIcons();
        }
      });
      optionsEl.appendChild(delBtn);
    }

    cardEl.appendChild(optionsEl);

    // Toggle options popup on card click
    cardEl.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Select layer if it is a canvas layer
      if (layer.id !== 'text-media') {
        mgr.activeLayerId = layer.id;
      }
      
      // Highlight active card directly in DOM
      document.querySelectorAll('.sk-layer-card').forEach(card => {
        card.classList.remove('active');
      });
      cardEl.classList.add('active');
      
      const isVisible = optionsEl.style.display === 'flex';
      
      // Close all other popups
      document.querySelectorAll('.sk-layer-options').forEach(pop => {
        pop.style.display = 'none';
      });
      
      // Toggle current popup
      optionsEl.style.display = isVisible ? 'none' : 'flex';
    });

    container.appendChild(cardEl);
  }
}

function syncSketchbookToolbarHighlights() {
  document.querySelectorAll('.modes-section .sk-btn').forEach(b => b.classList.remove('active'));
  
  if (document.body.classList.contains('mode-browse')) {
    const btn = document.getElementById('sk-tool-browse');
    if (btn) btn.classList.add('active');
  } else if (document.body.classList.contains('mode-text')) {
    const btn = document.getElementById('sk-tool-text');
    if (btn) btn.classList.add('active');
  } else if (document.body.classList.contains('mode-draw')) {
    // Find which drawing tool is active
    const penBtn = document.getElementById('tool-pen');
    const eraserBtn = document.getElementById('tool-eraser');
    const lassoBtn = document.getElementById('tool-lasso');
    const bucketBtn = document.getElementById('tool-bucket');
    
    if (penBtn && penBtn.classList.contains('active')) {
      const btn = document.getElementById('sk-tool-pen');
      if (btn) btn.classList.add('active');
    } else if (eraserBtn && eraserBtn.classList.contains('active')) {
      const btn = document.getElementById('sk-tool-eraser');
      if (btn) btn.classList.add('active');
    } else if (lassoBtn && lassoBtn.classList.contains('active')) {
      const btn = document.getElementById('sk-tool-lasso');
      if (btn) btn.classList.add('active');
    } else if (bucketBtn && bucketBtn.classList.contains('active')) {
      const btn = document.getElementById('sk-tool-bucket');
      if (btn) btn.classList.add('active');
    }
  }
}

function setupSketchbookEvents() {
  const getActiveCanvasManager = () => {
    if (!book) return null;
    let pageNum = book.activePageNum;
    if (book.layoutMode === 'double') {
      pageNum = book.getCurrentPages().left || book.getCurrentPages().right || 1;
    }
    return canvasManagers[pageNum];
  };

  // 1. Map Modes
  const browseBtn = document.getElementById('tool-browse');
  const textBtn = document.getElementById('tool-text');
  const penBtn = document.getElementById('tool-pen');
  const eraserBtn = document.getElementById('tool-eraser');
  const lassoBtn = document.getElementById('tool-lasso');
  const bucketBtn = document.getElementById('tool-bucket');

  const bindSkBtn = (skBtnId, sidebarBtn) => {
    const skBtn = document.getElementById(skBtnId);
    if (skBtn && sidebarBtn) {
      skBtn.addEventListener('click', () => {
        sidebarBtn.click();
      });
    }
  };

  bindSkBtn('sk-tool-browse', browseBtn);
  bindSkBtn('sk-tool-text', textBtn);
  bindSkBtn('sk-tool-pen', penBtn);
  bindSkBtn('sk-tool-eraser', eraserBtn);
  bindSkBtn('sk-tool-lasso', lassoBtn);
  bindSkBtn('sk-tool-bucket', bucketBtn);

  // 2. Undo / Redo
  const skUndo = document.getElementById('sk-undo');
  const skRedo = document.getElementById('sk-redo');
  if (skUndo) {
    skUndo.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) mgr.undo();
    });
  }
  if (skRedo) {
    skRedo.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) mgr.redo();
    });
  }

  // 3. Size presets
  document.querySelectorAll('.sk-size-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.sk-size-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      const size = parseFloat(dot.dataset.size);
      updateAllCanvasBrushes(mgr => mgr.setBrushSize(size));
      // Sync sidebar slider
      const slider = document.getElementById('brush-size');
      if (slider) slider.value = size;
    });
  });

  // 4. Color presets & Active color popover puck click handlers
  const skActiveColorBtn = document.getElementById('sk-active-color-btn');
  const skColorPopover = document.getElementById('sk-color-popover');
  
  if (skActiveColorBtn && skColorPopover) {
    skActiveColorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = skColorPopover.style.display === 'block';
      skColorPopover.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (!skColorPopover.contains(e.target) && e.target !== skActiveColorBtn) {
        skColorPopover.style.display = 'none';
      }
    });
  }

  document.querySelectorAll('.sk-color-dot').forEach(dot => {
    if (dot.id === 'sk-rainbow') return;
    dot.addEventListener('click', () => {
      document.querySelectorAll('.sk-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      const color = dot.dataset.color;
      if (color) {
        // Update active color button background color!
        if (skActiveColorBtn) {
          skActiveColorBtn.style.backgroundColor = color;
        }
        
        // Sync with standard canvas brushes
        updateAllCanvasBrushes(mgr => {
          mgr.setEraserMode(false);
          mgr.setBrushColor(color);
        });
        
        // Close popover
        if (skColorPopover) skColorPopover.style.display = 'none';
      }
    });
  });

  const skRainbow = document.getElementById('sk-rainbow');
  const customColorInputWheel = document.getElementById('custom-brush-color');
  if (skRainbow && customColorInputWheel) {
    skRainbow.addEventListener('click', () => {
      document.querySelectorAll('.sk-color-dot').forEach(d => d.classList.remove('active'));
      skRainbow.classList.add('active');
      customColorInputWheel.click();
    });

    customColorInputWheel.addEventListener('input', (e) => {
      const color = e.target.value;
      if (skActiveColorBtn) {
        skActiveColorBtn.style.backgroundColor = color;
      }
      updateAllCanvasBrushes(mgr => {
        mgr.setEraserMode(false);
        mgr.setBrushColor(color);
      });
    });
    
    customColorInputWheel.addEventListener('change', () => {
      if (skColorPopover) skColorPopover.style.display = 'none';
    });
  }

  // 5. More actions dropdown toggle
  const skMenuBtn = document.getElementById('sk-menu-btn');
  const skMenuDropdown = document.getElementById('sk-menu-dropdown');
  if (skMenuBtn && skMenuDropdown) {
    skMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = skMenuDropdown.style.display === 'block';
      skMenuDropdown.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (!skMenuDropdown.contains(e.target) && e.target !== skMenuBtn) {
        skMenuDropdown.style.display = 'none';
      }
    });
  }

  // 6. Action items in dropdown
  const actionUpload = document.getElementById('sk-action-upload');
  const actionClear = document.getElementById('sk-action-clear');
  const actionPdf = document.getElementById('sk-action-pdf');
  const actionShare = document.getElementById('sk-action-share');

  if (actionUpload) {
    actionUpload.addEventListener('click', () => {
      const fileInput = document.getElementById('media-file-input');
      if (fileInput) fileInput.click();
      skMenuDropdown.style.display = 'none';
    });
  }
  if (actionClear) {
    actionClear.addEventListener('click', () => {
      const clearBtn = document.getElementById('clear-page-btn');
      if (clearBtn) clearBtn.click();
      skMenuDropdown.style.display = 'none';
    });
  }
  if (actionPdf) {
    actionPdf.addEventListener('click', () => {
      const pdfBtn = document.getElementById('download-pdf-btn');
      if (pdfBtn) pdfBtn.click();
      skMenuDropdown.style.display = 'none';
    });
  }
  if (actionShare) {
    actionShare.addEventListener('click', () => {
      // Toggle sidebar share section overlay visible
      alert('公開分享已啟用！您可以在側欄設定分享，或者複製當前頁面專屬連結。');
      skMenuDropdown.style.display = 'none';
    });
  }

  // 7. Add layer button dialog
  const skAddLayer = document.getElementById('sk-add-layer');
  if (skAddLayer) {
    skAddLayer.addEventListener('click', () => {
      const mgr = getActiveCanvasManager();
      if (mgr) {
        const layerCount = mgr.layers.length + 1;
        const newLayer = {
          id: 'layer_' + Math.random().toString(36).substr(2, 9),
          name: `圖層 ${layerCount}`,
          visible: true,
          locked: false
        };
        const textMediaIdx = mgr.layers.findIndex(l => l.id === 'text-media');
        if (textMediaIdx !== -1) {
          mgr.layers.splice(textMediaIdx, 0, newLayer);
        } else {
          mgr.layers.push(newLayer);
        }
        mgr.activeLayerId = newLayer.id;
        mgr.onSave(mgr.getPaths());
        renderLayersList();
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  // 8. Bind Lasso Selection Fill button inside Bottom Panel
  const skFillSelectionBtn = document.getElementById('sk-fill-selection');
  if (skFillSelectionBtn) {
    skFillSelectionBtn.addEventListener('click', () => {
      // Find active color
      let activeColor = '#1e1e1e';
      const activeDot = document.querySelector('.sk-color-dot.active');
      if (activeDot && activeDot.id !== 'sk-rainbow') {
        activeColor = activeDot.dataset.color;
      } else if (skActiveColorBtn) {
        activeColor = skActiveColorBtn.style.backgroundColor;
      } else {
        const customInput = document.getElementById('custom-brush-color');
        if (customInput) activeColor = customInput.value;
      }

      let targetPageNum = null;
      for (const pageNum of EDITABLE_PAGES) {
        const mgr = canvasManagers[pageNum];
        if (mgr && mgr.lastLassoPoints && mgr.lastLassoPoints.length > 2) {
          targetPageNum = pageNum;
          break;
        }
      }

      if (targetPageNum) {
        const mgr = canvasManagers[targetPageNum];
        mgr.fillSelection(activeColor);
        skFillSelectionBtn.style.display = 'none';
      }
    });
  }

  // Also bind lasso-selected and selection-cleared events to show/hide bottom panel fill button
  for (const pageNum of EDITABLE_PAGES) {
    const canvasEl = document.getElementById(`canvas-${pageNum}`);
    if (canvasEl) {
      canvasEl.addEventListener('lasso-selected', () => {
        if (skFillSelectionBtn) skFillSelectionBtn.style.display = 'flex';
      });
      canvasEl.addEventListener('selection-cleared', () => {
        if (skFillSelectionBtn) skFillSelectionBtn.style.display = 'none';
      });
    }
  }

  // Trigger initial synchronization of Sketchbook highlight states
  syncSketchbookToolbarHighlights();

  // 9. Full-screen Background Input Canvas Pointer Event Forwarding to Page Canvas
  let activeDrawPageNum = null;
  const globalInputCanvas = document.getElementById('global-input-canvas');
  if (globalInputCanvas) {
    const forwardEvent = (e) => {
      // Find the active draw page on pointerdown
      if (e.type === 'pointerdown') {
        const currentPages = window.book ? window.book.getCurrentPages() : null;
        let targetPageNum = window.book ? window.book.activePageNum : null;
        
        if (window.book && window.book.layoutMode === 'double' && currentPages) {
          const leftPageNum = currentPages.left;
          const rightPageNum = currentPages.right;
          
          if (leftPageNum) {
            const leftCanvas = document.getElementById(`canvas-${leftPageNum}`);
            if (leftCanvas) {
              const rect = window.getSafeRect(leftCanvas, leftPageNum);
              if (e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom) {
                targetPageNum = leftPageNum;
              }
            }
          }
          if (rightPageNum) {
            const rightCanvas = document.getElementById(`canvas-${rightPageNum}`);
            if (rightCanvas) {
              const rect = window.getSafeRect(rightCanvas, rightPageNum);
              if (e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom) {
                targetPageNum = rightPageNum;
              }
            }
          }
        } else if (window.book && window.book.layoutMode === 'single') {
          const activePageNum = window.book.activePageNum;
          if (activePageNum) {
            const canvasEl = document.getElementById(`canvas-${activePageNum}`);
            if (canvasEl) {
              const rect = window.getSafeRect(canvasEl, activePageNum);
              if (e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom) {
                targetPageNum = activePageNum;
              }
            }
          }
        }
        activeDrawPageNum = targetPageNum;
      }
      
      if (activeDrawPageNum) {
        const activeCanvas = document.getElementById(`canvas-${activeDrawPageNum}`);
        if (activeCanvas) {
          const clonedEvent = new PointerEvent(e.type, {
            clientX: e.clientX,
            clientY: e.clientY,
            pointerType: e.pointerType,
            pressure: e.pressure,
            bubbles: true,
            cancelable: true
          });
          activeCanvas.dispatchEvent(clonedEvent);
        }
      }
      
      if (e.type === 'pointerup' || e.type === 'pointercancel') {
        activeDrawPageNum = null;
      }
    };

    globalInputCanvas.addEventListener('pointerdown', forwardEvent);
    globalInputCanvas.addEventListener('pointermove', forwardEvent);
    globalInputCanvas.addEventListener('pointerup', forwardEvent);
    globalInputCanvas.addEventListener('pointercancel', forwardEvent);

    // Prevent Safari default scrolling/gestures on the global input canvas
    globalInputCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
    }, { passive: false });
    globalInputCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });
  }

  window.addEventListener('resize', () => {
    const globalInputCanvas = document.getElementById('global-input-canvas');
    const globalInputContainer = document.getElementById('global-input-container');
    if (globalInputCanvas && globalInputContainer && globalInputContainer.style.display === 'block') {
      globalInputCanvas.width = window.innerWidth;
      globalInputCanvas.height = window.innerHeight;
    }
  });
}
