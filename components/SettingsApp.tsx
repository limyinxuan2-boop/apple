
import React, { useState, useEffect } from 'react';
import { AppSettings, Character, BackupData, FurnaceConfig, OfflineConfig, HomeConfig } from '../types';
import { fetchModels } from '../services/aiService';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_OS_PROMPT, DEFAULT_OFFLINE_PROMPT } from '../constants';

interface SettingsProps {
  settings: AppSettings;
  updateSettings: (newSettings: AppSettings) => void;
  characters: Character[];
  onUpdateCharacters: (chars: Character[]) => void;
  onClose: () => void;
}

const DEFAULT_FURNACE_CONFIG: FurnaceConfig = {
    autoEnabled: false,
    autoThreshold: 20,
    autoScope: 30,
    manualScope: 30
};

const DEFAULT_OFFLINE_CONFIG: OfflineConfig = {
    systemPrompt: DEFAULT_OFFLINE_PROMPT,
    style: '细腻、沉浸、小说感',
    wordCount: 150,
    bgUrl: '',
    indicatorColor: '#f59e0b'
};

const DEFAULT_HOME_CONFIG: HomeConfig = {
    banner: 'https://picsum.photos/id/16/600/300?grayscale',
    albumImages: [
        'https://picsum.photos/id/10/200/200?grayscale',
        'https://picsum.photos/id/11/200/200?grayscale',
        'https://picsum.photos/id/12/200/200?grayscale'
    ],
    statusText: '我不會再讓你一個人了',
    signature: '@如果天黑前来得及，我要忘了你的眼睛',
    polaroid: {
        image: 'https://picsum.photos/id/30/300/300?grayscale',
        text: 'First Choice'
    }
};

const SettingsApp: React.FC<SettingsProps> = ({ settings, updateSettings, characters, onUpdateCharacters, onClose }) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFetchMsg, setModelFetchMsg] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  
  const [importMsg, setImportMsg] = useState('');
  const [pendingImport, setPendingImport] = useState<BackupData | null>(null);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleFetchModels = async () => {
    setLoadingModels(true);
    setModelFetchMsg('');
    try {
        const models = await fetchModels(localSettings);
        if (models.length > 0) {
            setLocalSettings({ ...localSettings, availableModels: models });
            setModelFetchMsg(`✅ 成功获取 ${models.length} 个模型`);
        } else {
            setModelFetchMsg('⚠️ 未能获取模型，已使用默认列表');
        }
    } catch (e) {
        setModelFetchMsg('❌ 获取失败，请检查 URL 和 Key');
    }
    setLoadingModels(false);
    setTimeout(() => setModelFetchMsg(''), 3000);
  };

  const handleSave = () => {
    updateSettings(localSettings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) setLocalSettings({ ...localSettings, wallpaper: event.target.result as string });
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleResetWallpaper = () => {
      setLocalSettings({ ...localSettings, wallpaper: '' }); // Empty string implies default
  };

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const fontUrl = event.target?.result as string;
        const newStyle = document.createElement('style');
        newStyle.appendChild(document.createTextNode(`@font-face { font-family: 'CustomUserFont'; src: url('${fontUrl}'); }`));
        document.head.appendChild(newStyle);
        setLocalSettings({ ...localSettings, customFont: 'CustomUserFont' });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExportBackup = () => {
      try {
        const backupData: BackupData = {
            version: 1,
            type: 'small_phone_backup',
            timestamp: Date.now(),
            settings: settings,
            characters: characters.map(c => ({
                ...c,
                messages: Array.isArray(c.messages) ? c.messages.slice(-50) : [],
                scenarios: Array.isArray(c.scenarios) ? c.scenarios.map(s => ({
                    ...s,
                    messages: s.messages ? s.messages.slice(-50) : []
                })) : [],
                moments: Array.isArray(c.moments) ? c.moments : [],
                diaries: Array.isArray(c.diaries) ? c.diaries : [],
                memories: Array.isArray(c.memories) ? c.memories : [],
                styleConfig: c.styleConfig || undefined,
                furnaceConfig: c.furnaceConfig || DEFAULT_FURNACE_CONFIG,
                offlineConfig: c.offlineConfig || DEFAULT_OFFLINE_CONFIG,
                showOS: c.showOS ?? false,
                realTimeMode: c.realTimeMode ?? false,
                useLocalPersona: c.useLocalPersona ?? false,
                autoPostMoments: c.autoPostMoments ?? true
            }))
        };

        const dataStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SmallPhone_Backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setImportMsg("✅ 导出成功");
        setTimeout(() => setImportMsg(""), 3000);
      } catch (e) {
          console.error(e);
          alert("导出失败");
      }
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const file = input.files?.[0];
      if (!file) return;
      input.value = '';
      setImportMsg("⏳ 正在解析...");
      setPendingImport(null);

      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = event.target?.result as string;
              if (!json) throw new Error("文件内容为空");
              const data = JSON.parse(json);
              if (!data.settings && !data.characters) throw new Error("无效备份数据");

              // Deep merge logic to ensure new fields (like homeConfig) are present even if missing in backup
              const mergedSettings: AppSettings = {
                  ...settings, // Start with current defaults
                  ...data.settings, // Overwrite with backup
                  // Ensure objects are merged, not just replaced if missing keys
                  homeConfig: {
                      ...DEFAULT_HOME_CONFIG,
                      ...(data.settings.homeConfig || {})
                  },
                  globalPersona: {
                      ...settings.globalPersona,
                      ...(data.settings.globalPersona || {})
                  }
              };

              const validBackup: BackupData = {
                  version: data.version || 1,
                  type: 'small_phone_backup',
                  timestamp: data.timestamp || Date.now(),
                  settings: mergedSettings,
                  characters: Array.isArray(data.characters) ? data.characters : []
              };
              setPendingImport(validBackup);
              setImportMsg("❓ 等待确认...");
          } catch (err: any) {
              setImportMsg(`❌ ${err.message}`);
              alert(`导入失败: ${err.message}`);
          }
      };
      reader.readAsText(file);
  };

  const confirmImport = () => {
      if (!pendingImport) return;
      try {
          if (pendingImport.settings) {
              updateSettings(pendingImport.settings);
              setLocalSettings(pendingImport.settings);
          }
          if (pendingImport.characters && Array.isArray(pendingImport.characters)) {
              const sanitizedChars = pendingImport.characters.map((c: any) => ({
                  ...c,
                  furnaceConfig: { ...DEFAULT_FURNACE_CONFIG, ...(c.furnaceConfig || {}) },
                  offlineConfig: { ...DEFAULT_OFFLINE_CONFIG, ...(c.offlineConfig || {}) },
                  scenarios: Array.isArray(c.scenarios) ? c.scenarios : [],
                  diaries: Array.isArray(c.diaries) ? c.diaries : [],
                  memories: Array.isArray(c.memories) ? c.memories : [],
                  moments: Array.isArray(c.moments) ? c.moments : [],
                  messages: Array.isArray(c.messages) ? c.messages : [],
                  styleConfig: c.styleConfig || undefined,
                  useLocalPersona: c.useLocalPersona ?? false,
                  realTimeMode: c.realTimeMode ?? false,
                  showOS: c.showOS ?? false,
                  autoPostMoments: c.autoPostMoments ?? true
              }));
              onUpdateCharacters(sanitizedChars);
          }
          setImportMsg(`✅ 导入成功`);
          setPendingImport(null);
      } catch (e: any) {
          setImportMsg("❌ 应用数据失败");
      }
  };

  const cancelImport = () => {
      setPendingImport(null);
      setImportMsg("🚫 操作已取消");
  };

  const handleFactoryReset = () => {
      if (window.confirm("确定要恢复出厂设置吗？这将删除所有数据！")) {
          localStorage.removeItem('small_phone_settings');
          localStorage.removeItem('small_phone_chars');
          window.location.reload();
      }
  };

  return (
    <div className="h-full bg-gray-100 flex flex-col text-black overflow-y-auto relative">
      <div className="bg-white p-4 shadow flex items-center sticky top-0 z-10 justify-between">
        <div className="flex items-center">
            <button onClick={onClose} className="mr-4 text-gray-600 active:text-gray-900"><i className="fas fa-home text-xl"></i></button>
            <h1 className="text-xl font-bold">系统设置</h1>
        </div>
      </div>

      <div className="p-4 space-y-6 pb-24 animate-fade-in">
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
             <h2 className="font-bold text-blue-800 mb-2 flex items-center gap-2"><i className="fas fa-info-circle"></i> 关于小手机</h2>
             <p className="text-xs text-blue-600 leading-relaxed font-bold">⚠️ 请务必经常使用下方的【导出备份】功能！</p>
             <p className="text-[10px] text-blue-400 mt-2">Version 2.5.0 (Global Shell & Wallpaper)</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm flex items-center justify-between">
             <div><h2 className="font-bold text-gray-700">全屏沉浸模式</h2><p className="text-xs text-gray-400">移除手机边框</p></div>
             <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={localSettings.fullScreenMode} onChange={(e) => setLocalSettings({...localSettings, fullScreenMode: e.target.checked})} />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
             </label>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm">
            <h2 className="font-bold mb-4 text-gray-700 border-l-4 border-amber-500 pl-2">数据备份与恢复</h2>
            {importMsg && <div className={`mb-3 p-2 rounded text-xs font-bold text-center ${importMsg.includes('❌') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>{importMsg}</div>}
            <div className="flex gap-4">
                <button onClick={handleExportBackup} className="flex-1 py-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg font-bold flex flex-col items-center justify-center gap-1 active:bg-amber-100 transition"><i className="fas fa-file-export text-xl"></i><span className="text-xs">导出备份 (JSON)</span></button>
                <div className="flex-1 relative">
                    <input type="file" accept="*" onChange={handleImportFileSelect} className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" />
                    <button className="w-full h-full py-3 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg font-bold flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition"><i className="fas fa-file-import text-xl"></i><span className="text-xs">导入备份</span></button>
                </div>
            </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm">
          <h2 className="font-bold mb-4 text-gray-700 border-l-4 border-blue-500 pl-2">大模型连接 (Custom)</h2>
          <div className="space-y-4">
            <div>
                <label className="block text-xs text-gray-500 uppercase font-bold mb-1">API Key</label>
                <div className="relative">
                    <input 
                        type="password" 
                        value={localSettings.apiKey} 
                        onChange={(e) => setLocalSettings({...localSettings, apiKey: e.target.value})} 
                        className="w-full border-b border-gray-300 py-2 bg-transparent appearance-none focus:outline-none focus:border-blue-500 font-mono text-sm"
                        placeholder="在此粘贴 API Key..." 
                    />
                    <i className="fas fa-key absolute right-2 top-3 text-gray-300 pointer-events-none"></i>
                </div>
            </div>
            
            <div>
                <label className="block text-xs text-gray-500 uppercase font-bold mb-1">API Base URL</label>
                <div className="relative">
                    <input 
                        type="text" 
                        value={localSettings.apiUrl} 
                        onChange={(e) => setLocalSettings({...localSettings, apiUrl: e.target.value})} 
                        className="w-full border-b border-gray-300 py-2 bg-transparent appearance-none focus:outline-none focus:border-blue-500 font-mono text-sm"
                        placeholder="https://generativelanguage.googleapis.com" 
                    />
                    <i className="fas fa-globe absolute right-2 top-3 text-gray-300 pointer-events-none"></i>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">留空则使用默认 Google 地址。如需中转/代理请填写完整 Base URL。</p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs text-gray-500 uppercase font-bold">模型选择</label>
                  <button onClick={handleFetchModels} disabled={loadingModels} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 active:bg-blue-100 transition">
                      {loadingModels ? '连接中...' : '☁️ 拉取模型列表'}
                  </button>
              </div>
              {modelFetchMsg && <div className="text-[10px] text-center mb-1 text-orange-600 font-bold">{modelFetchMsg}</div>}
              <div className="relative">
                <select value={localSettings.model} onChange={(e) => setLocalSettings({...localSettings, model: e.target.value})} className="w-full border-b border-gray-300 py-2 bg-transparent appearance-none focus:outline-none focus:border-blue-500">
                    {localSettings.availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <i className="fas fa-chevron-down absolute right-2 top-3 text-gray-400 pointer-events-none"></i>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm">
          <h2 className="font-bold mb-4 text-gray-700 border-l-4 border-purple-500 pl-2">个性化</h2>
          <div className="space-y-4">
            <div>
                <label className="block text-xs text-gray-500 uppercase font-bold mb-2">主屏幕壁纸</label>
                <div className="flex gap-2">
                    <input type="file" accept="image/*" onChange={handleWallpaperUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
                    <button onClick={handleResetWallpaper} className="px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-full hover:bg-gray-200 whitespace-nowrap">恢复默认</button>
                </div>
            </div>
            <div><label className="block text-xs text-gray-500 uppercase font-bold mb-2">全局字体</label><input type="file" accept="*" onChange={handleFontUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" /></div>
            
            {/* Immersive Font Size Setting */}
            <div>
               <div className="flex justify-between items-center mb-1">
                   <label className="block text-xs text-gray-500 uppercase font-bold">沉浸/剧场模式字号</label>
                   <span className="text-xs text-purple-600 font-bold">{localSettings.immersiveFontSize || 18}px</span>
               </div>
               <input 
                 type="range" min="14" max="30" step="1" 
                 value={localSettings.immersiveFontSize || 18} 
                 onChange={(e) => setLocalSettings({...localSettings, immersiveFontSize: parseInt(e.target.value)})}
                 className="w-full accent-purple-600 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
               />
            </div>
          </div>
        </div>
        
        <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-100 mt-8">
            <h2 className="font-bold mb-2 text-red-700 flex items-center gap-2"><i className="fas fa-radiation"></i> 危险操作</h2>
            <button onClick={handleFactoryReset} className="w-full py-3 bg-red-600 text-white rounded-lg font-bold shadow-lg hover:bg-red-700 active:scale-95 transition">恢复出厂设置</button>
        </div>
      </div>

      <div className="bg-white p-4 border-t border-gray-200 sticky bottom-0 z-20">
          <button onClick={handleSave} className={`w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all ${isSaved ? 'bg-green-500 scale-95' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}>{isSaved ? '已保存配置' : '保存配置'}</button>
      </div>

      {pendingImport && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
              <div className="bg-white w-full rounded-2xl p-6 shadow-2xl animate-fade-in">
                  <div className="flex flex-col items-center mb-4 text-center">
                      <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mb-4"><i className="fas fa-file-import"></i></div>
                      <h3 className="text-xl font-bold text-gray-900">发现备份数据</h3>
                      <p className="text-sm text-gray-500 mt-2">包含角色: {pendingImport.characters?.length || 0} 个</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6"><p className="text-xs text-amber-700 mt-1">导入操作将<span className="font-bold underline">完全覆盖</span>当前的所有数据。此操作无法撤销。</p></div>
                  <div className="flex gap-3">
                      <button onClick={cancelImport} className="flex-1 py-3 border border-gray-300 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition">取消</button>
                      <button onClick={confirmImport} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition">确认覆盖导入</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default SettingsApp;
