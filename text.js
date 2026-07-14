// text.js - Overlay Block Manager (Supports Texts, Images, Videos with Drag & Resize)

export class TextManager {
  constructor(container, options = {}) {
    this.container = container; // The .text-layer element
    this.onSave = options.onSave || (() => {});
    this.isReadOnly = options.isReadOnly || false;
    this.pageNum = options.pageNum;
    
    this.texts = []; // Array of blocks: { id, type, x, y, width, height, content }
    this.draggedBlock = null;
    this.dragStart = { x: 0, y: 0 };
    this.blockStart = { x: 0, y: 0 };

    this.setupEvents();
  }

  // Load blocks from DB and render
  loadTexts(texts) {
    this.texts = JSON.parse(JSON.stringify(texts || []));
    this.render();
  }

  getTexts() {
    return this.texts;
  }

  clear() {
    this.texts = [];
    this.render();
    this.onSave(this.texts);
  }

  // Render all blocks in container
  render() {
    this.container.innerHTML = '';
    
    this.texts.forEach(item => {
      const blockEl = this.createBlockElement(item);
      this.container.appendChild(blockEl);
    });
  }

  // Create individual DOM element for block (Text or Media)
  createBlockElement(item) {
    const blockEl = document.createElement('div');
    blockEl.dataset.id = item.id;
    
    // Set position as percentage
    blockEl.style.left = `${item.x}%`;
    blockEl.style.top = `${item.y}%`;
    if (item.rotation) {
      blockEl.style.transform = `rotate(${item.rotation}deg)`;
    }

    const isMedia = item.type === 'image' || item.type === 'video';

    if (isMedia) {
      blockEl.className = 'text-block media-block';
      blockEl.style.width = item.width ? `${item.width}%` : '40%';
      blockEl.style.height = item.height ? `${item.height}%` : '25%';
      
      if (item.type === 'image') {
        const img = document.createElement('img');
        img.src = item.content;
        img.alt = 'Uploaded Image';
        // Prevent image drag defaults to allow our own drag implementation
        img.addEventListener('dragstart', (e) => e.preventDefault());
        blockEl.appendChild(img);
      } else if (item.type === 'video') {
        const video = document.createElement('video');
        video.src = item.content;
        video.controls = true;
        // In read-only mode, we allow controls. In edit, too.
        blockEl.appendChild(video);
      }
      
      if (!this.isReadOnly) {
        // Add Resize Handle
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        blockEl.appendChild(handle);
        
        handle.addEventListener('pointerdown', (e) => this.handleResizeStart(e, blockEl, item));
      }
    } else {
      // Default to Text Block (for backward compatibility)
      blockEl.className = 'text-block';
      
      const viewEl = document.createElement('div');
      viewEl.className = 'text-block-view';
      viewEl.innerHTML = item.content || '點擊編輯...';
      blockEl.appendChild(viewEl);

      if (!this.isReadOnly) {
        blockEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.startEdit(blockEl, item);
        });
      }
    }

    // Common delete button & drag/drop behavior (if not read-only)
    if (!this.isReadOnly) {
      const delBtn = document.createElement('div');
      delBtn.className = 'delete-trigger';
      delBtn.innerHTML = '&times;';
      delBtn.title = '刪除此區塊';
      delBtn.addEventListener('pointerdown', (e) => {
        // Stop drag propagation
        e.stopPropagation();
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteBlock(item.id);
      });
      blockEl.appendChild(delBtn);
      
      blockEl.addEventListener('pointerdown', (e) => this.handleDragStart(e, blockEl, item));
    }

    return blockEl;
  }

  // Delete a block
  deleteBlock(id) {
    this.texts = this.texts.filter(t => t.id !== id);
    this.render();
    this.onSave(this.texts);
  }

  // Add text block at specific pointer click coordinates
  addBlock(clickX, clickY) {
    if (this.isReadOnly) return;

    const rect = window.getSafeRect ? window.getSafeRect(this.container, this.pageNum) : this.container.getBoundingClientRect();
    const x = parseFloat((((clickX - rect.left) / rect.width) * 100).toFixed(2));
    const y = parseFloat((((clickY - rect.top) / rect.height) * 100).toFixed(2));

    const newItem = {
      id: 'txt_' + Math.random().toString(36).substr(2, 9),
      type: 'text',
      x: Math.min(90, Math.max(2, x)),
      y: Math.min(95, Math.max(2, y)),
      content: ''
    };

    this.texts.push(newItem);
    this.render();

    const blockEl = this.container.querySelector(`[data-id="${newItem.id}"]`);
    if (blockEl) {
      this.startEdit(blockEl, newItem);
    }
  }

  // Add media block at center
  addMediaBlock(type, content) {
    if (this.isReadOnly) return;

    const newItem = {
      id: 'med_' + Math.random().toString(36).substr(2, 9),
      type: type, // 'image' or 'video'
      x: 30, // Default center
      y: 35,
      width: 40,
      height: 30,
      content: content
    };

    this.texts.push(newItem);
    this.render();
    this.onSave(this.texts);
  }

  // Enter edit mode for text block
  startEdit(blockEl, item) {
    if (blockEl.classList.contains('editing')) return;
    blockEl.classList.add('editing');

    const viewEl = blockEl.querySelector('.text-block-view');
    if (viewEl.innerHTML === '點擊編輯...') {
      viewEl.innerHTML = '';
    }

    viewEl.contentEditable = 'true';
    viewEl.focus();

    // Create rich-text toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-text-toolbar';
    toolbar.addEventListener('pointerdown', (e) => {
      // Prevent focus shift when clicking buttons, but allow select elements to open native dropdowns
      if (e.target.tagName !== 'SELECT') {
        e.preventDefault();
      }
    });

    toolbar.innerHTML = `
      <select class="font-select">
        <option value="">字型</option>
        <option value="var(--font-ui)">預設字型</option>
        <option value="Klee One, serif">楷體 (Klee)</option>
        <option value="Playfair Display, serif">襯線體 (Playfair)</option>
        <option value="cursive">手寫體 (Cursive)</option>
        <option value="monospace">等寬體</option>
      </select>
      <select class="size-select">
        <option value="">大小</option>
        <option value="2">小</option>
        <option value="3">中</option>
        <option value="5">大</option>
        <option value="7">特大</option>
      </select>
      <select class="color-select">
        <option value="">顏色</option>
        <option value="#1e1e1e">預設黑</option>
        <option value="#cc3333">紅色</option>
        <option value="#0066cc">藍色</option>
        <option value="#008844">綠色</option>
        <option value="#8b5cf6">紫色</option>
        <option value="#f97316">橘色</option>
        <option value="#ec4899">粉色</option>
      </select>
      <button class="bold-btn" title="粗體"><b>B</b></button>
      <button class="italic-btn" title="斜體"><i>I</i></button>
      <button class="link-btn" title="插入連結">🔗</button>
      <button class="done-btn" title="完成">確定</button>
    `;

    blockEl.appendChild(toolbar);

    // Toolbar button listeners
    const fontSelect = toolbar.querySelector('.font-select');
    const sizeSelect = toolbar.querySelector('.size-select');
    const colorSelect = toolbar.querySelector('.color-select');
    const boldBtn = toolbar.querySelector('.bold-btn');
    const italicBtn = toolbar.querySelector('.italic-btn');
    const linkBtn = toolbar.querySelector('.link-btn');
    const doneBtn = toolbar.querySelector('.done-btn');

    fontSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        document.execCommand('fontName', false, e.target.value);
      }
    });

    sizeSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        document.execCommand('fontSize', false, e.target.value);
      }
    });

    colorSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        document.execCommand('foreColor', false, e.target.value);
      }
    });

    boldBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.execCommand('bold', false, null);
    });

    italicBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.execCommand('italic', false, null);
    });

    linkBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const url = prompt('請輸入連結網址:', 'https://');
      if (url) {
        document.execCommand('createLink', false, url);
      }
    });

    const finishEdit = () => {
      viewEl.contentEditable = 'false';
      const cleanHTML = viewEl.innerHTML.trim();
      
      toolbar.remove();
      blockEl.classList.remove('editing');

      // Clean up global click outside listeners
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      
      const textVal = viewEl.innerText.trim();
      if (textVal === '' && (cleanHTML === '' || cleanHTML === '<br>')) {
        this.deleteBlock(item.id);
      } else {
        item.content = cleanHTML;
        this.onSave(this.texts);
      }
    };

    const handleOutsideClick = (e) => {
      if (!blockEl.contains(e.target)) {
        finishEdit();
      }
    };

    doneBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      finishEdit();
    });

    // Register listeners after current event finishes bubbling
    setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }, 100);
  }

  // Resize Drag Action
  handleResizeStart(e, blockEl, item) {
    e.stopPropagation();
    e.preventDefault();

    const rect = window.getSafeRect ? window.getSafeRect(this.container, this.pageNum) : this.container.getBoundingClientRect();
    const startWidth = blockEl.clientWidth;
    const startHeight = blockEl.clientHeight;
    const startX = e.clientX;
    const startY = e.clientY;

    const handleResizeMove = (ev) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;

      const newWidthPx = startWidth + deltaX;
      const newHeightPx = startHeight + deltaY;

      // Convert to percent
      const newWidthPercent = parseFloat(((newWidthPx / rect.width) * 100).toFixed(2));
      const newHeightPercent = parseFloat(((newHeightPx / rect.height) * 100).toFixed(2));

      // Constraint bounds (10% to 90%)
      const clampedWidth = Math.min(90, Math.max(10, newWidthPercent));
      const clampedHeight = Math.min(90, Math.max(10, newHeightPercent));

      blockEl.style.width = `${clampedWidth}%`;
      blockEl.style.height = `${clampedHeight}%`;

      item.width = clampedWidth;
      item.height = clampedHeight;
    };

    const handleResizeEnd = () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeEnd);
      this.onSave(this.texts);
    };

    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
  }

  // Drag & drop movement implementation
  handleDragStart(e, blockEl, item) {
    // If editing, resizing, or hitting triggers, don't drag
    if (blockEl.classList.contains('editing') || 
        e.target.classList.contains('delete-trigger') ||
        e.target.classList.contains('resize-handle') ||
        e.target.tagName === 'VIDEO' || // Allow video play controls to be clicked
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA') {
      return;
    }

    e.preventDefault();
    this.draggedBlock = { element: blockEl, item };
    this.dragStart = { x: e.clientX, y: e.clientY };
    
    this.blockStart = { 
      x: parseFloat(blockEl.style.left), 
      y: parseFloat(blockEl.style.top) 
    };

    const handleMove = (ev) => this.handleDragMove(ev);
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      this.handleDragEnd();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
  }

  handleDragMove(e) {
    if (!this.draggedBlock) return;

    const rect = window.getSafeRect ? window.getSafeRect(this.container, this.pageNum) : this.container.getBoundingClientRect();
    const deltaX = e.clientX - this.dragStart.x;
    const deltaY = e.clientY - this.dragStart.y;

    const deltaPercentX = (deltaX / rect.width) * 100;
    const deltaPercentY = (deltaY / rect.height) * 100;

    let newX = parseFloat((this.blockStart.x + deltaPercentX).toFixed(2));
    let newY = parseFloat((this.blockStart.y + deltaPercentY).toFixed(2));

    // Bounds constraint
    const maxBoundX = 100 - (this.draggedBlock.item.width || 40);
    const maxBoundY = 100 - (this.draggedBlock.item.height || 25);
    
    newX = Math.min(Math.max(1, newX), Math.max(1, maxBoundX));
    newY = Math.min(Math.max(1, newY), Math.max(1, maxBoundY));

    this.draggedBlock.element.style.left = `${newX}%`;
    this.draggedBlock.element.style.top = `${newY}%`;
    
    this.draggedBlock.item.x = newX;
    this.draggedBlock.item.y = newY;
  }

  handleDragEnd() {
    if (!this.draggedBlock) return;
    this.onSave(this.texts);
    this.draggedBlock = null;
  }

  setupEvents() {
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container && !this.isReadOnly) {
        this.addBlock(e.clientX, e.clientY);
      }
    });
  }
}
