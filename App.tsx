
import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, Character, AppRoute, HomeConfig } from './types';
import SettingsApp from './components/SettingsApp';
import WeChatApp from './components/wechat/WeChatApp';
import DiaryApp from './components/DiaryApp';

const App: React.FC = () => {
  // --- Global State ---
  const [route, setRoute] = useState<AppRoute>(AppRoute.HOME);
  const [currentTime, setCurrentTime] = useState(new Date());

  // --- Persistence ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('small_phone_settings');
    const defaultSettings: AppSettings = {
      apiUrl: 'https://generativelanguage.googleapis.com', 
      apiKey: '',
      model: 'gemini-1.5-flash',
      wallpaper: '', // Default empty (uses css default)
      fullScreenMode: false,
      immersiveFontSize: 18,
      widgets: [],
      homeConfig: {
          banner: 'https://picsum.photos/id/16/600/300', 
          albumImages: [
              'https://picsum.photos/id/10/200/200',
              'https://picsum.photos/id/11/200/200',
              'https://picsum.photos/id/12/200/200',
              'https://picsum.photos/id/13/200/200',
              'https://picsum.photos/id/14/200/200'
          ],
          statusText: '我不會再讓你一個人了',
          signature: '@如果天黑前来得及，我要忘了你的眼睛',
          polaroid: {
              image: 'https://picsum.photos/id/30/300/300?grayscale',
              text: 'First Choice'
          }
      },
      availableModels: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
      globalPersona: {
        name: '夜.',
        avatar: 'https://ui-avatars.com/api/?name=Night&background=333&color=fff',
        description: '一个普通用户',
        diaries: [],
        moments: []
      }
    };
    
    if (saved) {
        const parsed = JSON.parse(saved);
        return { 
            ...defaultSettings, 
            ...parsed, 
            homeConfig: { ...defaultSettings.homeConfig, ...(parsed.homeConfig || {}) },
            model: parsed.model || defaultSettings.model,
            immersiveFontSize: parsed.immersiveFontSize || 18,
            globalPersona: {
                ...defaultSettings.globalPersona,
                ...(parsed.globalPersona || {}),
                diaries: parsed.globalPersona?.diaries || [],
                moments: parsed.globalPersona?.moments || []
            }
        };
    }
    return defaultSettings;
  });

  const [characters, setCharacters] = useState<Character[]>(() => {
    const saved = localStorage.getItem('small_phone_chars');
    return saved ? JSON.parse(saved) : [];
  });

  // --- Edit Modal State ---
  const [editModal, setEditModal] = useState<{
      show: boolean;
      title: string;
      value: string;
      onSave: (val: string) => void;
  }>({ show: false, title: '', value: '', onSave: () => {} });

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('small_phone_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('small_phone_chars', JSON.stringify(characters));
  }, [characters]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Handlers ---
  
  const updateHomeConfig = (updates: Partial<HomeConfig>) => {
      setSettings(prev => ({
          ...prev,
          homeConfig: { ...(prev.homeConfig || {
              banner: '', albumImages: [], statusText: '', signature: '', polaroid: { image: '', text: '' }
          }), ...updates }
      }));
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => { if (ev.target?.result) updateHomeConfig({ banner: ev.target!.result as string }); };
          reader.readAsDataURL(file);
      }
  };

  const handleGlobalAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => { 
            if (ev.target?.result) {
                setSettings(prev => ({
                    ...prev,
                    globalPersona: { ...prev.globalPersona, avatar: ev.target!.result as string }
                }));
            }
          };
          reader.readAsDataURL(file);
      }
  };

  const handleAlbumUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => { 
              if (ev.target?.result) {
                  const newImages = [...(settings.homeConfig?.albumImages || [])];
                  newImages[index] = ev.target!.result as string;
                  updateHomeConfig({ albumImages: newImages });
              }
          };
          reader.readAsDataURL(file);
      }
  };

  const handlePolaroidUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => { 
              if (ev.target?.result) {
                  updateHomeConfig({ polaroid: { ...(settings.homeConfig?.polaroid || {text:''}), image: ev.target!.result as string } });
              }
          };
          reader.readAsDataURL(file);
      }
  };

  // --- Edit Handlers (Open Custom Modal) ---

  const openEditName = () => {
      setEditModal({
          show: true,
          title: "修改名字",
          value: settings.globalPersona.name,
          onSave: (val) => setSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, name: val } }))
      });
  };

  const openEditSignature = () => {
      setEditModal({
          show: true,
          title: "修改个性签名",
          value: settings.homeConfig?.signature || '',
          onSave: (val) => updateHomeConfig({ signature: val })
      });
  };

  const openEditStatus = () => {
      setEditModal({
          show: true,
          title: "修改状态文本",
          value: settings.homeConfig?.statusText || '',
          onSave: (val) => updateHomeConfig({ statusText: val })
      });
  };

  const openEditPolaroidText = () => {
      setEditModal({
          show: true,
          title: "修改拍立得文字",
          value: settings.homeConfig?.polaroid?.text || '',
          onSave: (val) => updateHomeConfig({ polaroid: { ...(settings.homeConfig?.polaroid || {image:''}), text: val } })
      });
  };

  // --- HOME SCREEN RENDERER (V3: Grid OS) ---
  const renderHome = () => {
      const bgStyle = settings.wallpaper 
          ? (settings.wallpaper.startsWith('#') ? { backgroundColor: settings.wallpaper } : { backgroundImage: `url(${settings.wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' })
          : { backgroundColor: '#fafaf9' }; // default stone-50

      return (
          <div className="h-full w-full flex flex-col relative overflow-hidden font-sans animate-fade-in" style={bgStyle}>
             
             {/* Main Content Area */}
             <div className="flex-1 overflow-y-auto p-6 space-y-5 no-scrollbar relative z-10">
                 
                 {/* 1. Personal Widget (Header) */}
                 <div className="bg-white rounded-[24px] shadow-sm border border-stone-100 relative overflow-hidden group">
                     {/* Banner Bg for Widget */}
                     <div className="h-28 bg-stone-200 relative group/banner z-0">
                         {settings.homeConfig?.banner && <img src={settings.homeConfig.banner} className="w-full h-full object-cover" />}
                         <div className="absolute inset-0 bg-black/5 group-hover/banner:bg-black/10 transition flex items-center justify-center opacity-0 group-hover/banner:opacity-100 cursor-pointer pointer-events-none">
                            <i className="fas fa-camera text-white drop-shadow-md"></i>
                         </div>
                         {/* File Input for Banner: Lower Z-Index but interactive within banner area */}
                         <input type="file" accept="image/*" onChange={handleBannerUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" title="更换背景图"/>
                     </div>
                     
                     <div className="px-6 pb-6 relative z-30">
                         <div className="flex justify-between items-end -mt-10 mb-3">
                             {/* Avatar */}
                             <div className="w-20 h-20 rounded-2xl border-4 border-white shadow-sm relative group/avatar cursor-pointer bg-stone-100 overflow-hidden">
                                  <img src={settings.globalPersona.avatar} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition text-white z-20 pointer-events-none"><i className="fas fa-camera"></i></div>
                                  <input type="file" accept="image/*" onChange={handleGlobalAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer z-30" />
                             </div>
                             
                             {/* Status Pill */}
                             <div onClick={openEditStatus} className="bg-stone-100 px-3 py-1.5 rounded-full flex items-center gap-2 cursor-pointer hover:bg-stone-200 transition active:scale-95 group/status relative z-30">
                                 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                 <span className="text-xs font-bold text-stone-600 max-w-[120px] truncate">{settings.homeConfig?.statusText || 'Set Status'}</span>
                                 <i className="fas fa-pen text-[10px] text-stone-400 opacity-0 group-hover/status:opacity-100"></i>
                             </div>
                         </div>
  
                         {/* Editable Info */}
                         <div className="relative z-30">
                             <div onClick={openEditName} className="font-bold text-2xl text-stone-900 cursor-pointer transition w-fit flex items-center gap-2 group/edit mb-1 hover:text-stone-600 bg-white/50 backdrop-blur-sm rounded px-1 -ml-1">
                                 {settings.globalPersona.name}
                                 <i className="fas fa-pen text-xs text-stone-300 opacity-0 group-hover/edit:opacity-100"></i>
                             </div>
                             <div onClick={openEditSignature} className="text-sm text-stone-500 cursor-pointer transition w-fit flex items-center gap-2 group/edit hover:text-stone-800 bg-white/50 backdrop-blur-sm rounded px-1 -ml-1">
                                 {settings.homeConfig?.signature || '点击设置签名'}
                                 <i className="fas fa-pen text-xs text-stone-300 opacity-0 group-hover/edit:opacity-100"></i>
                             </div>
                         </div>
                     </div>
                 </div>
  
                 {/* 2. Main Grid */}
                 <div className="grid grid-cols-2 gap-4">
                     
                     {/* App Stack */}
                     <div className="grid grid-cols-2 gap-3 h-fit">
                         <button onClick={() => setRoute(AppRoute.WECHAT)} className="aspect-square bg-white rounded-2xl shadow-sm border border-stone-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition hover:shadow-md hover:border-green-100 group">
                             <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition"><i className="fas fa-comment"></i></div>
                             <span className="text-[10px] font-bold text-stone-600">微信</span>
                         </button>
                         <button onClick={() => setRoute(AppRoute.DIARY)} className="aspect-square bg-white rounded-2xl shadow-sm border border-stone-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition hover:shadow-md hover:border-amber-100 group">
                             <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition"><i className="fas fa-book"></i></div>
                             <span className="text-[10px] font-bold text-stone-600">日记</span>
                         </button>
                         <button onClick={() => setRoute(AppRoute.SETTINGS)} className="aspect-square bg-white rounded-2xl shadow-sm border border-stone-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition hover:shadow-md hover:border-gray-100 group">
                             <div className="w-10 h-10 bg-gray-50 text-gray-600 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition"><i className="fas fa-cog"></i></div>
                             <span className="text-[10px] font-bold text-stone-600">设置</span>
                         </button>
                         <button className="aspect-square bg-white rounded-2xl shadow-sm border border-stone-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition hover:shadow-md opacity-50 cursor-not-allowed">
                             <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center text-xl"><i className="fas fa-music"></i></div>
                             <span className="text-[10px] font-bold text-stone-600">音乐</span>
                         </button>
                     </div>
  
                     {/* Polaroid Widget */}
                     <div className="relative h-full min-h-[160px] flex items-center justify-center pl-2">
                         <div className="absolute inset-0 bg-stone-200 rounded-[28px] rotate-6 opacity-40 transform scale-90 translate-x-2 translate-y-2"></div>
                         <div className="relative bg-white p-2 pb-6 shadow-[0_8px_30px_rgb(0,0,0,0.08)] -rotate-2 transform transition hover:rotate-0 hover:scale-105 duration-300 w-full flex flex-col items-center rounded-lg border border-stone-50">
                             <div className="w-8 h-8 absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-stone-600 drop-shadow-sm"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" /></svg>
                             </div>
                             <div className="bg-stone-100 w-full aspect-square mb-3 relative group cursor-pointer overflow-hidden rounded-sm">
                                 {settings.homeConfig?.polaroid?.image && <img src={settings.homeConfig.polaroid.image} className="w-full h-full object-cover" />}
                                 <input type="file" accept="image/*" onChange={handlePolaroidUpload} className="absolute inset-0 opacity-0 cursor-pointer z-20" />
                                 <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white pointer-events-none transition z-10"><i className="fas fa-camera"></i></div>
                             </div>
                             <div onClick={openEditPolaroidText} className="font-handwriting text-stone-600 text-sm text-center cursor-pointer hover:text-stone-900 truncate w-full px-1 hover:bg-stone-50 rounded">
                                 {settings.homeConfig?.polaroid?.text || 'Memories'}
                             </div>
                         </div>
                     </div>
                 </div>
  
                 {/* 3. Memories Strip */}
                 <div className="mt-2">
                     <div className="flex justify-between items-center px-1 mb-3">
                         <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1"><i className="fas fa-history"></i> Moments</span>
                     </div>
                     <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar px-1 snap-x">
                         {(settings.homeConfig?.albumImages || []).map((img, idx) => (
                             <div key={idx} className="relative min-w-[90px] h-[90px] rounded-xl overflow-hidden shadow-sm shrink-0 snap-start border border-stone-100 group">
                                 <img src={img} className="w-full h-full object-cover" />
                                 <input type="file" accept="image/*" onChange={(e) => handleAlbumUpload(idx, e)} className="absolute inset-0 opacity-0 cursor-pointer z-20" />
                                 <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white pointer-events-none z-10"><i className="fas fa-pen"></i></div>
                             </div>
                         ))}
                         <div className="min-w-[90px] h-[90px] rounded-xl border-2 border-dashed border-stone-200 flex items-center justify-center text-stone-300">
                             <i className="fas fa-plus"></i>
                         </div>
                     </div>
                 </div>
             </div>
          </div>
      );
  };

  // --- GLOBAL APP RENDERER ---
  return (
    <div className={`
        relative overflow-hidden font-sans flex flex-col bg-black text-stone-800 shadow-2xl transition-all duration-300
        ${settings.fullScreenMode ? 'w-full h-full rounded-none border-0' : 'w-[375px] h-[812px] rounded-[40px] border-8 border-gray-900'}
    `}>
       
       {/* Global Status Bar */}
       <div className="h-8 px-6 flex justify-between items-center text-xs font-bold text-stone-600 bg-white/80 backdrop-blur-md relative z-50 shrink-0">
         <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
         <div className="flex gap-2 items-center">
            <i className="fas fa-signal"></i>
            <i className="fas fa-wifi"></i>
            <i className="fas fa-battery-half"></i>
         </div>
       </div>

       {/* Screen Content Area: ALL apps live inside here */}
       <div className="flex-1 overflow-hidden relative bg-white">
          {route === AppRoute.HOME && renderHome()}
          {route === AppRoute.WECHAT && <WeChatApp settings={settings} onUpdateSettings={setSettings} characters={characters} onUpdateCharacters={setCharacters} onClose={() => setRoute(AppRoute.HOME)} />}
          {route === AppRoute.DIARY && <DiaryApp settings={settings} onUpdateSettings={setSettings} characters={characters} onUpdateCharacters={setCharacters} onClose={() => setRoute(AppRoute.HOME)} />}
          {route === AppRoute.SETTINGS && <SettingsApp settings={settings} updateSettings={setSettings} characters={characters} onUpdateCharacters={setCharacters} onClose={() => setRoute(AppRoute.HOME)} />}
       </div>

       {/* --- CUSTOM EDIT MODAL (Bottom Sheet) --- */}
       {editModal.show && (
           <div className="absolute inset-0 z-[100] bg-black/30 backdrop-blur-sm flex flex-col justify-end" onClick={() => setEditModal({...editModal, show: false})}>
               <div className="bg-white rounded-t-3xl p-6 animate-slide-up shadow-2xl" onClick={e => e.stopPropagation()}>
                   <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6"></div>
                   <h3 className="font-bold text-lg mb-4 text-stone-800">{editModal.title}</h3>
                   <input
                       autoFocus
                       value={editModal.value}
                       onChange={(e) => setEditModal({ ...editModal, value: e.target.value })}
                       onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                               editModal.onSave(editModal.value);
                               setEditModal({ ...editModal, show: false });
                           }
                       }}
                       className="w-full bg-stone-100 p-4 rounded-xl text-lg mb-6 focus:outline-none focus:ring-2 focus:ring-stone-800 text-stone-800"
                   />
                   <div className="flex gap-3">
                       <button onClick={() => setEditModal({...editModal, show: false})} className="flex-1 py-3 bg-stone-100 font-bold text-stone-500 rounded-xl hover:bg-stone-200 transition">取消</button>
                       <button onClick={() => {
                           editModal.onSave(editModal.value);
                           setEditModal({ ...editModal, show: false });
                       }} className="flex-1 py-3 bg-stone-900 font-bold text-white rounded-xl hover:bg-stone-800 transition shadow-lg">保存</button>
                   </div>
                   <div className="h-4"></div> {/* Safe area */}
               </div>
           </div>
       )}

    </div>
  );
};

export default App;
