// db.js - Database & Sync Module

let supabase = null;
let dbConfig = null;
let realtimeSubscription = null;
let onUpdateCallback = null;

// Read config from LocalStorage on load
try {
  const savedConfig = localStorage.getItem('antigravity_db_config');
  if (savedConfig) {
    dbConfig = JSON.parse(savedConfig);
    initSupabase(dbConfig.url, dbConfig.key);
  }
} catch (e) {
  console.error('Failed to load DB config from localStorage', e);
}

function initSupabase(url, key) {
  try {
    if (window.supabase) {
      supabase = window.supabase.createClient(url, key);
      dbConfig = { url, key };
      return true;
    }
  } catch (e) {
    console.error('Supabase initialization failed', e);
  }
  return false;
}

export const db = {
  // Check if cloud sync is connected
  isConnected() {
    return supabase !== null;
  },

  getDbConfig() {
    return dbConfig;
  },

  // Save config and connect
  async connectCloud(url, key) {
    const success = initSupabase(url, key);
    if (!success) throw new Error('無法載入 Supabase SDK。請檢查網路或 CDN。');

    // Test connection by fetching a row (or simple check)
    const { data, error } = await supabase
      .from('notebook_pages')
      .select('id')
      .limit(1);
    
    if (error) {
      console.error('Supabase connection test failed:', error);
      supabase = null;
      throw new Error(`資料庫連接失敗: ${error.message}。請確認資料表 notebook_pages 是否已正確建立。`);
    }

    // Save to localStorage if successful
    localStorage.setItem('antigravity_db_config', JSON.stringify({ url, key }));
    
    // Sync local storage content to cloud (upward sync)
    await this.syncLocalToCloud();
    return true;
  },

  // Disconnect cloud sync
  disconnectCloud() {
    supabase = null;
    dbConfig = null;
    localStorage.removeItem('antigravity_db_config');
    if (realtimeSubscription) {
      realtimeSubscription.unsubscribe();
      realtimeSubscription = null;
    }
  },

  // Sync all LocalStorage data to cloud on first connection
  async syncLocalToCloud() {
    if (!supabase) return;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('antigravity_page_')) {
        const pageNum = parseInt(key.replace('antigravity_page_', ''), 10);
        if (!isNaN(pageNum)) {
          const localData = JSON.parse(localStorage.getItem(key));
          const pageId = `page_${pageNum}`;
          
          await supabase.from('notebook_pages').upsert({
            id: pageId,
            page_num: pageNum,
            drawings: localData.drawings || [],
            texts: localData.texts || [],
            is_shared: localData.is_shared || false,
            updated_at: new Date().toISOString()
          });
        }
      }
    }
  },

  // Load a page's data (drawings, texts, is_shared)
  async loadPage(pageNum) {
    const pageId = `page_${pageNum}`;

    // Try cloud first if connected
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('notebook_pages')
          .select('*')
          .eq('id', pageId)
          .single();

        if (error) {
          // If not found in database, insert initial page
          if (error.code === 'PGRST116') { // PGRST116 is code for "0 rows returned"
            const initialData = this.loadLocalPage(pageNum) || { drawings: [], texts: [], is_shared: false };
            await supabase.from('notebook_pages').insert({
              id: pageId,
              page_num: pageNum,
              drawings: initialData.drawings,
              texts: initialData.texts,
              is_shared: initialData.is_shared,
              updated_at: new Date().toISOString()
            });
            return initialData;
          }
          throw error;
        }

        // Save local copy as backup
        this.saveLocalPage(pageNum, data);
        return data;
      } catch (e) {
        console.warn('雲端載入失敗，改用本地快取數據:', e);
      }
    }

    // Fallback to LocalStorage
    return this.loadLocalPage(pageNum) || { drawings: [], texts: [], is_shared: false };
  },

  // Load specifically for shared read-only page
  async loadSharedPage(pageId) {
    if (!supabase) {
      // LocalStorage share demo fallback
      const match = pageId.match(/^page_(\d+)$/);
      if (match) {
        const pageNum = parseInt(match[1], 10);
        const data = this.loadLocalPage(pageNum);
        if (data && data.is_shared) {
          return data;
        }
      }
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('notebook_pages')
        .select('*')
        .eq('id', pageId)
        .single();
      
      if (error) throw error;
      if (data && data.is_shared) {
        return data;
      }
    } catch (e) {
      console.error('Failed to load shared page:', e);
    }
    return null;
  },

  // Save a page's content
  async savePage(pageNum, drawings, texts) {
    const pageId = `page_${pageNum}`;
    const pageData = { drawings, texts };

    // 1. Save to local storage first (always, for fast response & offline durability)
    const localCurrent = this.loadLocalPage(pageNum) || { is_shared: false };
    const mergedData = { ...localCurrent, ...pageData };
    this.saveLocalPage(pageNum, mergedData);

    // 2. Sync to cloud if connected
    if (supabase) {
      try {
        const { error } = await supabase
          .from('notebook_pages')
          .upsert({
            id: pageId,
            page_num: pageNum,
            drawings: mergedData.drawings,
            texts: mergedData.texts,
            is_shared: mergedData.is_shared,
            updated_at: new Date().toISOString()
          });

        if (error) throw error;
      } catch (e) {
        console.error('雲端自動存檔失敗，已暫存於本地:', e);
      }
    }
  },

  // Toggle page sharing status
  async toggleShare(pageNum, isShared) {
    const pageId = `page_${pageNum}`;
    
    // Save locally
    const localCurrent = this.loadLocalPage(pageNum) || { drawings: [], texts: [] };
    localCurrent.is_shared = isShared;
    this.saveLocalPage(pageNum, localCurrent);

    // Save cloud
    if (supabase) {
      try {
        const { error } = await supabase
          .from('notebook_pages')
          .update({ is_shared: isShared, updated_at: new Date().toISOString() })
          .eq('id', pageId);

        if (error) throw error;
      } catch (e) {
        console.error('雲端分享設定更新失敗:', e);
        throw e;
      }
    }
    return isShared;
  },

  // Upload image/video to Supabase Storage (fallback to local base64 if bucket doesn't exist)
  async uploadMedia(file) {
    if (!supabase) return null;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `notebook_uploads/${fileName}`;

      // Upload file to bucket 'notebook_media'
      const { data, error } = await supabase.storage
        .from('notebook_media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        // If error is bucket not found, log warning and return null
        if (error.message.toLowerCase().includes('bucket') || error.message.toLowerCase().includes('does not exist')) {
          console.warn('Supabase Storage bucket "notebook_media" not found. Falling back to local Base64.');
          return null;
        }
        throw error;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('notebook_media')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (e) {
      console.warn('Supabase Storage upload failed, falling back to Base64:', e);
      return null;
    }
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

  // Realtime subscription setup
  subscribeRealtime(pageNum, onUpdate) {
    if (!supabase) return;
    
    if (realtimeSubscription) {
      realtimeSubscription.unsubscribe();
    }

    const pageId = `page_${pageNum}`;
    onUpdateCallback = onUpdate;

    realtimeSubscription = supabase
      .channel(`page_changes_${pageNum}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notebook_pages',
          filter: `id=eq.${pageId}`
        },
        (payload) => {
          if (payload.new && onUpdateCallback) {
            // Save local cache backup
            this.saveLocalPage(pageNum, payload.new);
            onUpdateCallback(payload.new);
          }
        }
      )
      .subscribe();
  },

  unsubscribeRealtime() {
    if (realtimeSubscription) {
      realtimeSubscription.unsubscribe();
      realtimeSubscription = null;
    }
    onUpdateCallback = null;
  }
};
