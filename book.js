// book.js - 3D Page Flip Engine & Responsive Scaler

export class Book {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.wrapper = this.container.querySelector('.pages-wrapper');
    this.onPageChange = options.onPageChange || (() => {});
    
    this.currentSheet = 0;
    this.totalContentSheets = parseInt(localStorage.getItem('notebook_content_sheets') || '3');
    this.totalSheets = this.totalContentSheets + 2; // Cover + Content sheets + BackCover
    this.totalPageCount = (this.totalContentSheets + 1) * 2;
    this.sheets = [];

    // Zoom and pan states
    this.userScale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.fitScale = 1.0;
    
    // Layout states
    this.layoutMode = 'double'; // 'double' or 'single'
    this.activePageNum = 1;
    
    this.init();
  }

  init() {
    this.createPages();
    this.setupGestures();
    this.setupResize();
    this.updateBookLayout();
  }

  // Create pages structure dynamically
  createPages() {
    this.wrapper.innerHTML = '';
    this.sheets = [];

    // Sheet 0: Cover (front) & Page 1 Intro (back)
    this.createSheet(0, `
      <div class="page front cover-front">
        <div class="cover-content" style="padding-top: 50px; justify-content: flex-start; align-items: center;">
          <div class="cute-title-tag" style="background: rgba(255, 255, 255, 0.9); padding: 16px 28px; border-radius: 24px; border: 3px dashed #ff9bb8; box-shadow: 0 8px 24px rgba(224,94,131,0.15); display: inline-block; transform: rotate(-2deg); margin-top: 40px; text-align: center; max-width: 80%;">
            <span style="font-size: 14px; display: block; color: #ff9bb8; margin-bottom: 4px; font-weight: 600; font-family: 'Comic Sans MS', cursive;">🌸 Jocelyn's Murmurs</span>
            <h1 class="cover-title" style="font-size: 24px; color: #e05e83; margin: 0; font-weight: 700; font-family: 'DFKai-SB', 'Kiwi Maru', 'Microsoft JhengHei', sans-serif; letter-spacing: 1px;">Jocelyn的碎碎念</h1>
          </div>
        </div>
      </div>
      <div class="page back" data-page-num="1">
        <div class="paper-inner">
          <div class="page-header" style="height: 24px; border: none; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; z-index: 10;">
            <input type="text" class="page-title-input" id="page-title-1" placeholder="（未命名章節）" style="width: 80%; border: none; background: transparent; text-align: center; font-size: 13px; font-weight: 600; color: #555; outline: none; font-family: var(--font-book); border-bottom: 1px dashed transparent; transition: border-color 0.2s ease; padding: 2px 0;" data-page-num="1">
          </div>
          <div class="page-body-container" id="page-body-1">
            <!-- Layers -->
            <div class="text-layer" id="text-layer-1"></div>
            <canvas class="drawing-canvas" id="canvas-1"></canvas>
          </div>
          <div class="page-footer" style="position: absolute; bottom: 12px; left: 16px; font-size: 11px; color: #9ca3af; font-family: var(--font-ui); font-weight: 500; border: none; margin: 0; padding: 0; text-align: left; z-index: 5;">
            1
          </div>
        </div>
      </div>
    `);

    // Generate content sheets dynamically
    for (let i = 1; i <= this.totalContentSheets; i++) {
      this.createContentSheet(i, i * 2, i * 2 + 1);
    }

    // Sheet totalContentSheets + 1: Inside Back Cover (front) & Back Cover (back)
    const endSheetIdx = this.totalContentSheets + 1;
    const endPageNum = endSheetIdx * 2;
    const backCoverPageNum = endPageNum + 1;

    this.createSheet(endSheetIdx, `
      <div class="page front">
        <div class="paper-inner">
          <div class="page-header"><span>尾聲</span><span>Page ${endPageNum}</span></div>
          <div class="page-body-container" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; height: 80%;">
            <i data-lucide="book-check" style="width: 48px; height: 48px; color: var(--color-primary); margin-bottom: 16px;"></i>
            <h2 style="font-family: var(--font-book); margin-bottom: 12px; font-size: 22px;">筆記結束</h2>
            <p style="color: #555; font-size: 14px; max-width: 280px; line-height: 1.6;">
              本頁為最後一頁。您可以點擊右上角分享特定頁面，或連接 Supabase 將筆記即時儲存至雲端。
            </p>
          </div>
          <div class="page-footer">反重力翻書筆記本</div>
        </div>
      </div>
      <div class="page back cover-back" data-page-num="${backCoverPageNum}">
        <div class="cover-content" style="padding-top: 60px; justify-content: flex-start; align-items: center;">
          <div class="cute-title-tag" style="background: rgba(255, 255, 255, 0.9); padding: 12px 20px; border-radius: 18px; border: 2px dashed #9ca3af; box-shadow: 0 4px 12px rgba(0,0,0,0.05); display: inline-block; transform: rotate(1deg); margin-top: 50px;">
            <span style="font-size: 13px; color: #7a7a7a; font-family: 'Comic Sans MS', cursive; font-weight: 600;">❤️ Jocelyn</span>
          </div>
        </div>
      </div>
    `);

    if (window.lucide) window.lucide.createIcons();
  }

  createSheet(index, htmlContent) {
    const sheetEl = document.createElement('div');
    sheetEl.className = 'sheet';
    sheetEl.innerHTML = htmlContent;
    sheetEl.dataset.sheetIndex = index;
    this.wrapper.appendChild(sheetEl);
    this.sheets.push(sheetEl);
  }

  createContentSheet(sheetIndex, leftPageNum, rightPageNum) {
    const html = `
      <!-- Left Page of Sheet (Visible on the left when flipped) -->
      <div class="page back" data-page-num="${rightPageNum}">
        <div class="paper-inner">
          <div class="page-header" style="height: 24px; border: none; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; z-index: 10;">
            <input type="text" class="page-title-input" id="page-title-${rightPageNum}" placeholder="（未命名章節）" style="width: 80%; border: none; background: transparent; text-align: center; font-size: 13px; font-weight: 600; color: #555; outline: none; font-family: var(--font-book); border-bottom: 1px dashed transparent; transition: border-color 0.2s ease; padding: 2px 0;" data-page-num="${rightPageNum}">
          </div>
          <div class="page-body-container" id="page-body-${rightPageNum}">
            <!-- Layers -->
            <div class="text-layer" id="text-layer-${rightPageNum}"></div>
            <canvas class="drawing-canvas" id="canvas-${rightPageNum}"></canvas>
          </div>
          <div class="page-footer" style="position: absolute; bottom: 12px; left: 16px; font-size: 11px; color: #9ca3af; font-family: var(--font-ui); font-weight: 500; border: none; margin: 0; padding: 0; text-align: left; z-index: 5;">
            ${rightPageNum}
          </div>
        </div>
      </div>
      
      <!-- Right Page of Sheet (Visible on the right when unflipped) -->
      <div class="page front" data-page-num="${leftPageNum}">
        <div class="paper-inner">
          <div class="page-header" style="height: 24px; border: none; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; z-index: 10;">
            <input type="text" class="page-title-input" id="page-title-${leftPageNum}" placeholder="（未命名章節）" style="width: 80%; border: none; background: transparent; text-align: center; font-size: 13px; font-weight: 600; color: #555; outline: none; font-family: var(--font-book); border-bottom: 1px dashed transparent; transition: border-color 0.2s ease; padding: 2px 0;" data-page-num="${leftPageNum}">
          </div>
          <div class="page-body-container" id="page-body-${leftPageNum}">
            <!-- Layers -->
            <div class="text-layer" id="text-layer-${leftPageNum}"></div>
            <canvas class="drawing-canvas" id="canvas-${leftPageNum}"></canvas>
          </div>
          <div class="page-footer" style="position: absolute; bottom: 12px; right: 16px; font-size: 11px; color: #9ca3af; font-family: var(--font-ui); font-weight: 500; border: none; margin: 0; padding: 0; text-align: right; z-index: 5;">
            ${leftPageNum}
          </div>
        </div>
      </div>
    `;
    this.createSheet(sheetIndex, html);
  }

  // Set depth and rotation
  updateBookLayout() {
    if (this.layoutMode === 'single') {
      this.sheets.forEach((sheet) => {
        sheet.style.transform = '';
        sheet.style.zIndex = '';
        sheet.style.pointerEvents = '';
      });
      this.updateActivePageClass();
    } else {
      this.sheets.forEach((sheet, idx) => {
        if (idx < this.currentSheet) {
          // Flipped to Left
          sheet.classList.add('flipped');
          sheet.style.transform = 'rotateY(-180deg)';
          sheet.style.zIndex = idx;
          // Disable pointers of pages hidden underneath
          sheet.style.pointerEvents = (idx === this.currentSheet - 1) ? 'auto' : 'none';
        } else {
          // Unflipped on Right
          sheet.classList.remove('flipped');
          sheet.style.transform = 'rotateY(0deg)';
          sheet.style.zIndex = this.totalSheets - idx;
          sheet.style.pointerEvents = (idx === this.currentSheet) ? 'auto' : 'none';
        }
      });
    }

    this.onPageChange(this.getCurrentPages());
  }

  setLayoutMode(mode) {
    this.layoutMode = mode;
    
    if (mode === 'single') {
      document.body.classList.add('single-page-mode');
      if (this.currentSheet === 0) {
        this.activePageNum = 1;
      } else if (this.currentSheet === this.totalContentSheets + 2) {
        this.activePageNum = this.totalPageCount + 1;
      } else {
        // Default to the left page of the current spread (odd page) to prevent jumping to page 2
        this.activePageNum = this.currentSheet * 2 - 1;
      }
    } else {
      document.body.classList.remove('single-page-mode');
      if (this.activePageNum === this.totalPageCount + 1) {
        this.currentSheet = this.totalContentSheets + 2;
      } else {
        this.currentSheet = Math.floor((this.activePageNum + 1) / 2);
      }
    }
    
    this.updateBookLayout();
    this.resizeBook();
  }

  rebuild() {
    this.totalContentSheets = parseInt(localStorage.getItem('notebook_content_sheets') || '3');
    this.totalSheets = this.totalContentSheets + 2;
    this.totalPageCount = (this.totalContentSheets + 1) * 2;

    this.createPages();
    this.updateBookLayout();
    this.resizeBook();
  }

  updateActivePageClass() {
    const allPages = this.container.querySelectorAll('.page');
    allPages.forEach(p => p.classList.remove('active-page'));
    this.sheets.forEach(s => s.classList.remove('active-sheet'));
    
    let activeEl = null;
    let activeSheet = null;
    if (this.activePageNum === 1) {
      activeSheet = this.sheets[0];
      activeEl = this.sheets[0].querySelector('.page.back');
    } else if (this.activePageNum === this.totalPageCount + 1) {
      activeSheet = this.sheets[this.totalContentSheets + 1];
      activeEl = this.sheets[this.totalContentSheets + 1].querySelector('.page.back');
    } else {
      const sheetIdx = Math.floor(this.activePageNum / 2);
      activeSheet = this.sheets[sheetIdx];
      const isEven = (this.activePageNum % 2 === 0);
      const pageClass = isEven ? '.page.front' : '.page.back';
      activeEl = this.sheets[sheetIdx] ? this.sheets[sheetIdx].querySelector(pageClass) : null;
    }
    
    if (activeEl) {
      activeEl.classList.add('active-page');
    }
    if (activeSheet) {
      activeSheet.classList.add('active-sheet');
    }
  }

  next() {
    if (this.layoutMode === 'single') {
      if (this.activePageNum < this.totalPageCount + 1) {
        this.activePageNum++;
        let targetSheet = 0;
        if (this.activePageNum > 1 && this.activePageNum < this.totalPageCount) {
          targetSheet = Math.floor(this.activePageNum / 2);
        } else if (this.activePageNum >= this.totalPageCount) {
          targetSheet = this.totalContentSheets + 1;
        }
        this.currentSheet = targetSheet;
        this.updateBookLayout();
      }
    } else {
      if (this.currentSheet < this.totalSheets) {
        this.currentSheet++;
        this.updateBookLayout();
      }
    }
  }

  prev() {
    if (this.layoutMode === 'single') {
      if (this.activePageNum > 1) {
        this.activePageNum--;
        let targetSheet = 0;
        if (this.activePageNum > 1 && this.activePageNum < this.totalPageCount) {
          targetSheet = Math.floor(this.activePageNum / 2);
        } else if (this.activePageNum >= this.totalPageCount) {
          targetSheet = this.totalContentSheets + 1;
        }
        this.currentSheet = targetSheet;
        this.updateBookLayout();
      }
    } else {
      if (this.currentSheet > 0) {
        this.currentSheet--;
        this.updateBookLayout();
      }
    }
  }

  zoomIn() {
    this.userScale = Math.min(2.5, this.userScale + 0.15);
    this.resizeBook();
  }

  zoomOut() {
    this.userScale = Math.max(0.5, this.userScale - 0.15);
    if (this.userScale <= 1.0) {
      this.panX = 0;
      this.panY = 0;
    }
    this.resizeBook();
  }

  zoomReset() {
    this.userScale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.resizeBook();
  }

  flipToPage(pageNum) {
    if (this.layoutMode === 'single') {
      this.activePageNum = pageNum;
    }
    
    let targetSheet = 0;
    if (pageNum === 1) {
      targetSheet = 1;
    } else if (pageNum === this.totalPageCount + 1) {
      targetSheet = this.totalContentSheets + 2;
    } else {
      targetSheet = Math.floor((pageNum + 1) / 2);
    }

    this.currentSheet = targetSheet;
    this.updateBookLayout();
  }

  getCurrentPages() {
    if (this.layoutMode === 'single') {
      if (this.activePageNum === 1) {
        return { type: 'cover', label: '封面', left: null, right: 1 };
      }
      if (this.activePageNum === 9) {
        return { type: 'backcover', label: '封底', left: 9, right: null };
      }
      return {
        type: 'spread',
        label: `第 ${this.activePageNum} 頁`,
        left: this.activePageNum,
        right: null
      };
    }

    if (this.currentSheet === 0) {
      return { type: 'cover', label: '封面', left: null, right: 1 };
    }
    if (this.currentSheet === 5) {
      return { type: 'backcover', label: '封底', left: 9, right: null };
    }
    
    const left = this.currentSheet * 2 - 1;
    const right = this.currentSheet * 2;

    return {
      type: 'spread',
      label: `第 ${left} - ${right} 頁`,
      left: left,
      right: right
    };
  }

  // Touch Swipe & Mouse Drag Settings
  setupGestures() {
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    const handleStart = (e) => {
      // Don't flip page if drawing or editing text
      let target = e.target;
      if (!target) return;
      if (target.nodeType === 3) target = target.parentNode; // Safe text node resolution
      if (typeof target.closest !== 'function') return;
      
      if (target.closest('.editor-sidebar') || 
          target.closest('.sketchbook-panel') || // Exclude floating Sketchbook panels (Undo, Redo, etc.)
          target.closest('.app-header') || 
          target.closest('.nav-arrow') || 
          target.closest('.tools-panel') || 
          target.closest('#sidebar-toggle-floating') || 
          target.classList.contains('drawing-canvas') || 
          target.closest('.text-layer') || 
          target.closest('.text-block') || 
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA') {
        return;
      }
      
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      startY = touch.clientY;
      isDragging = true;

      // Allow panning if zoomed in and in Browse Mode
      const isBrowseMode = document.body.classList.contains('mode-browse');
      if (this.userScale > 1.0 && isBrowseMode) {
        isPanning = true;
        startPanX = this.panX;
        startPanY = this.panY;
      } else {
        isPanning = false;
      }
    };

    const handleMove = (e) => {
      if (!isDragging) return;
      
      const touch = e.touches ? e.touches[0] : e;
      
      if (isPanning) {
        const finalScale = this.fitScale * this.userScale;
        const dx = (touch.clientX - startX) / finalScale;
        const dy = (touch.clientY - startY) / finalScale;
        
        this.panX = startPanX + dx;
        this.panY = startPanY + dy;
        
        this.container.style.transform = `scale(${finalScale}) translate(${this.panX}px, ${this.panY}px)`;
        return;
      }

      const diffX = touch.clientX - startX;
      const diffY = touch.clientY - startY;

      // Detect horizontal swipe
      if (Math.abs(diffX) > 120 && Math.abs(diffY) < 50) {
        if (diffX < 0) {
          this.next();
        } else {
          this.prev();
        }
        isDragging = false;
      }
    };

    const handleEnd = () => {
      isDragging = false;
      isPanning = false;
    };

    // Add event listeners to container
    this.container.addEventListener('mousedown', handleStart);
    this.container.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);

    this.container.addEventListener('touchstart', handleStart, { passive: true });
    this.container.addEventListener('touchmove', handleMove, { passive: true });
    this.container.addEventListener('touchend', handleEnd);
  }

  // Resize listener to scale the book component container
  setupResize() {
    window.addEventListener('resize', () => this.resizeBook());
    // Initial call
    setTimeout(() => this.resizeBook(), 100);
  }

  resizeBook() {
    const viewport = this.container.parentElement; // .book-viewport
    const stage = viewport ? viewport.parentElement : null; // .book-stage
    if (!stage) return;

    // Use grandparent book-stage to prevent flexbox child container expansion from overriding the true viewport limits
    const stageWidth = stage.clientWidth - 40; // Subtract padding (20px on mobile)
    const stageHeight = stage.clientHeight - 80;
    
    // Scale factor
    const isSingle = this.layoutMode === 'single';
    const bookWidth = isSingle ? (varValue('--book-width') / 2) : varValue('--book-width');
    const bookHeight = varValue('--book-height');

    const scaleX = stageWidth / bookWidth;
    const scaleY = stageHeight / bookHeight;
    this.fitScale = Math.min(scaleX, scaleY);
    
    // Set max scale to 1.3 in single page, and min scale to 0.4
    const maxScale = isSingle ? 1.3 : 1.0;
    this.fitScale = Math.min(maxScale, Math.max(0.4, this.fitScale));
    
    const finalScale = this.fitScale * this.userScale;
    
    this.container.style.transform = `scale(${finalScale}) translate(${this.panX}px, ${this.panY}px)`;

    // Update UI indicator text
    const zoomLevelVal = document.getElementById('zoom-level-val');
    if (zoomLevelVal) {
      zoomLevelVal.innerText = `${Math.round(this.userScale * 100)}%`;
    }
  }
}

// Helpers
function varValue(cssVar) {
  const rootStyle = getComputedStyle(document.documentElement);
  const val = rootStyle.getPropertyValue(cssVar).replace('px', '').trim();
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    if (cssVar === '--book-width') return 960;
    if (cssVar === '--book-height') return 600;
    return 1;
  }
  return parsed;
}
