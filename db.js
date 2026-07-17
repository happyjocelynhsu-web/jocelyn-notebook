// db.js - Database & Sync Module (GitHub Serverless Publisher & Local Storage Version)

let githubConfig = null;

// Read config from LocalStorage on load
try {
  const savedConfig = localStorage.getItem('antigravity_github_config');
  if (savedConfig) {
    githubConfig = JSON.parse(savedConfig);
  }
} catch (e) {
  console.error('Failed to load GitHub config from localStorage', e);
}

export const db = {
  // Check if connected (GitHub config is configured)
  isConnected() {
    return githubConfig !== null && githubConfig.token !== '';
  },

  getDbConfig() {
    return githubConfig;
  },

  // Save GitHub configuration
  saveGitHubConfig(repo, branch, token, bookId) {
    githubConfig = { repo, branch, token, bookId };
    localStorage.setItem('antigravity_github_config', JSON.stringify(githubConfig));
  },

  // Clear GitHub configuration
  clearGitHubConfig() {
    githubConfig = null;
    localStorage.removeItem('antigravity_github_config');
  },

  // Fetch the published book data from the server
  async loadPublishedBook(bookId) {
    try {
      const res = await fetch(`./data/${bookId}.json?t=${Date.now()}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn(`Failed to load published book ${bookId}:`, e);
    }
    return null;
  },

  // Load a page's data (drawings, texts, is_shared)
  async loadPage(pageNum) {
    const isEdit = new URLSearchParams(window.location.search).get('edit') === 'true';
    if (!isEdit) {
      // Reader mode: use the preloaded published book JSON
      if (window.publishedBook && window.publishedBook.pages) {
        const page = window.publishedBook.pages.find(p => p.pageNum === pageNum);
        if (page) {
          return {
            drawings: page.drawings || [],
            texts: page.texts || [],
            is_shared: page.is_shared || false
          };
        }
      }
    }

    // Fallback to LocalStorage for Edit mode or if published file is not loaded
    return this.loadLocalPage(pageNum) || { drawings: [], texts: [], is_shared: false };
  },

  // Dummy method to support shared page links if they visit it
  async loadSharedPage(pageId) {
    const match = pageId.match(/^page_(\d+)$/);
    if (match) {
      const pageNum = parseInt(match[1], 10);
      const data = await this.loadPage(pageNum);
      if (data && data.is_shared) {
        return data;
      }
    }
    return null;
  },

  // Save a page's content locally
  async savePage(pageNum, drawings, texts) {
    const localCurrent = this.loadLocalPage(pageNum) || { is_shared: false };
    const mergedData = { ...localCurrent, drawings, texts };
    this.saveLocalPage(pageNum, mergedData);
  },

  // Toggle page sharing status locally
  async toggleShare(pageNum, isShared) {
    const localCurrent = this.loadLocalPage(pageNum) || { drawings: [], texts: [] };
    localCurrent.is_shared = isShared;
    this.saveLocalPage(pageNum, localCurrent);
    return isShared;
  },

  // Convert uploaded image/video file to Base64 (Serverless storage)
  async uploadMedia(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // Local storage helpers
  saveLocalPage(pageNum, data) {
    localStorage.setItem(`antigravity_page_${pageNum}`, JSON.stringify(data));
  },

  loadLocalPage(pageNum) {
    try {
      const data = localStorage.getItem(`antigravity_page_${pageNum}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error(`Failed to parse local storage data for page ${pageNum}:`, e);
      return null;
    }
  },

  // Publish book data to GitHub via REST API
  async publishToGitHub(repo, branch, token, bookId, progressCallback) {
    if (!progressCallback) progressCallback = () => {};

    try {
      progressCallback('正在打包手稿資料...', 10);
      const numContentSheets = parseInt(localStorage.getItem('notebook_content_sheets') || '3');
      const totalPageCount = (numContentSheets + 1) * 2;
      const bookTitle = document.getElementById('page-title-1')?.value || "Jocelyn's Murmurs";

      // 1. Gather all pages to write into single JSON structure
      const pagesData = [];
      const pagesToExport = [1];
      for (let i = 1; i <= numContentSheets; i++) {
        pagesToExport.push(i * 2);
        pagesToExport.push(i * 2 + 1);
      }
      pagesToExport.push(totalPageCount);
      pagesToExport.push(totalPageCount + 1);

      for (const pageNum of pagesToExport) {
        const pageData = this.loadLocalPage(pageNum) || { drawings: [], texts: [], is_shared: false };
        const titleInput = document.getElementById(`page-title-${pageNum}`);
        const pageTitle = titleInput ? titleInput.value : '';
        pagesData.push({
          pageNum,
          title: pageTitle,
          drawings: pageData.drawings || [],
          texts: pageData.texts || [],
          is_shared: pageData.is_shared || false
        });
      }

      const payload = {
        bookId,
        title: bookTitle,
        totalPageCount,
        pages: pagesData,
        updatedAt: new Date().toISOString()
      };

      const jsonString = JSON.stringify(payload, null, 2);
      
      // UTF-8 base64 encoding workaround for btoa
      const base64Content = btoa(encodeURIComponent(jsonString).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode('0x' + p1);
      }));

      const path = `data/${bookId}.json`;
      const url = `https://api.github.com/repos/${repo}/contents/${path}`;

      // 2. Query GitHub to see if file already exists (required to get SHA for updates)
      progressCallback('正在向 GitHub 查詢檔案庫狀態...', 40);
      let sha = null;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache'
          }
        });
        if (res.status === 200) {
          const fileInfo = await res.json();
          sha = fileInfo.sha;
        }
      } catch (e) {
        console.warn('Failed to query file SHA, will attempt create:', e);
      }

      // 3. Upload content via PUT request
      progressCallback('正在將資料上傳提交至 GitHub...', 70);
      const commitBody = {
        message: `Publish book ${bookId} - ${new Date().toISOString()}`,
        content: base64Content,
        branch: branch
      };
      if (sha) {
        commitBody.sha = sha;
      }

      const uploadRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(commitBody)
      });

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        throw new Error(`GitHub API 回傳錯誤: ${uploadRes.status} ${errorText}`);
      }

      progressCallback('發布完成！GitHub Pages 將在 1 分鐘內完成靜態網頁更新！', 100);
      return true;
    } catch (e) {
      console.error('GitHub publishing failed:', e);
      progressCallback(`發布失敗: ${e.message}`, -1);
      throw e;
    }
  },

  // Dummy subscription support to avoid crashes in app.js
  subscribeRealtime(pageNum, onUpdate) {},
  unsubscribeRealtime() {}
};
