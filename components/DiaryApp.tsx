
import React, { useState, useRef } from 'react';
import { Character, AppSettings, DiaryEntry, UserDiaryEntry, PeekReaction } from '../types';
import { generateChatCompletion, interpolatePrompt } from '../services/aiService';
import { DIARY_PROMPT, PEEK_PROMPT } from '../constants';

interface DiaryAppProps {
  characters: Character[];
  settings: AppSettings;
  onUpdateCharacters: (chars: Character[]) => void;
  onUpdateSettings: (s: AppSettings) => void;
  onClose: () => void;
}

type DiaryTab = 'CHARS' | 'MY_DIARY';

// Helper Hook for Long Press within component
const useLongPress = (callback: (id: string, type: 'CHAR' | 'USER') => void, ms = 500) => {
  const timerRef = useRef<any>(null);

  const start = (id: string, type: 'CHAR' | 'USER') => {
    timerRef.current = setTimeout(() => {
      callback(id, type);
    }, ms);
  };

  const stop = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    onMouseDown: (id: string, type: 'CHAR' | 'USER') => () => start(id, type),
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: (id: string, type: 'CHAR' | 'USER') => () => start(id, type),
    onTouchEnd: stop,
  };
};

const DiaryApp: React.FC<DiaryAppProps> = ({ characters, settings, onUpdateCharacters, onUpdateSettings, onClose }) => {
  const [activeTab, setActiveTab] = useState<DiaryTab>('CHARS');
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingCharName, setGeneratingCharName] = useState<string>('');
  
  // Settings Modal for Diary Style
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  
  // My Diary State
  const [myDiaryTitle, setMyDiaryTitle] = useState('');
  const [myDiaryContent, setMyDiaryContent] = useState('');
  const [isWritingMyDiary, setIsWritingMyDiary] = useState(false);
  const [editingDiaryId, setEditingDiaryId] = useState<string | null>(null); // For editing existing diary
  const [peekModalEntryId, setPeekModalEntryId] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ id: string, type: 'CHAR' | 'USER' } | null>(null);

  const selectedChar = characters.find(c => c.id === selectedCharId);

  // Long Press Logic
  const handleLongPress = (id: string, type: 'CHAR' | 'USER') => {
      setContextMenu({ id, type });
  };
  const longPressEvents = useLongPress(handleLongPress);

  // --- Character Diary Logic ---

  const handleUpdateDiaryStyle = (val: string) => {
      if (!selectedChar) return;
      const updatedChar = { ...selectedChar, diaryStyle: val };
      onUpdateCharacters(characters.map(c => c.id === selectedChar.id ? updatedChar : c));
  };

  const handleGenerateDiary = async (rewriteEntryId?: string) => {
    if (!selectedChar) return;
    if (!settings.apiKey) {
        alert("请先配置 API Key");
        return;
    }

    setIsGenerating(true);
    setGeneratingCharName(selectedChar.remark);

    const userName = selectedChar.useLocalPersona ? selectedChar.userMaskName : settings.globalPersona.name;
    const recentMessages = selectedChar.messages.slice(-30).map(m => `${m.role}: ${m.content}`).join('\n');
    const memories = selectedChar.memories.map(m => `[长期记忆]: ${m.content}`).join('\n');
    const context = selectedChar.contextMemory ? `[当前重要上下文]: ${selectedChar.contextMemory}` : '';
    
    // Inject Custom Style if present
    const styleInstruction = selectedChar.diaryStyle 
        ? `\n[特别风格指导]: ${selectedChar.diaryStyle}\n` 
        : '';

    const prompt = interpolatePrompt(DIARY_PROMPT, {
        ai_name: selectedChar.name,
        user_name: userName,
    }) + styleInstruction + `\n\n${context}\n\n[参考长期记忆档案]\n${memories}\n\n[最近聊天互动]\n${recentMessages}`;

    try {
        const response = await generateChatCompletion([{ role: 'user', content: prompt }], settings);
        
        // JSON Parsing
        let jsonStr = response.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
        
        let parsed = { title: '无题', weather: '未知', mood: '平静', content: response };
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            console.warn("JSON parse failed, using raw", e);
        }

        const newEntry: DiaryEntry = {
            id: rewriteEntryId || Date.now().toString(),
            timestamp: Date.now(),
            title: parsed.title || '无题',
            weather: parsed.weather || '未知',
            mood: parsed.mood || '平静',
            content: parsed.content || response,
            isExpanded: true 
        };

        let updatedDiaries;
        if (rewriteEntryId) {
             updatedDiaries = selectedChar.diaries.map(d => d.id === rewriteEntryId ? newEntry : d);
        } else {
             updatedDiaries = [newEntry, ...(selectedChar.diaries || [])];
        }

        const updatedChar = {
            ...selectedChar,
            diaries: updatedDiaries
        };
        
        const updatedChars = characters.map(c => c.id === selectedChar.id ? updatedChar : c);
        onUpdateCharacters(updatedChars);

    } catch (e) {
        console.error("Diary Generation Error", e);
        alert("日记生成失败");
    }

    setIsGenerating(false);
    setGeneratingCharName('');
    setContextMenu(null);
  };

  const handleDeleteDiary = () => {
      if (!contextMenu) return;
      if (contextMenu.type === 'CHAR' && selectedChar) {
          const updatedDiaries = selectedChar.diaries.filter(d => d.id !== contextMenu.id);
          const updatedChar = { ...selectedChar, diaries: updatedDiaries };
          onUpdateCharacters(characters.map(c => c.id === selectedChar.id ? updatedChar : c));
      } else if (contextMenu.type === 'USER') {
          const updatedDiaries = settings.globalPersona.diaries.filter(d => d.id !== contextMenu.id);
          onUpdateSettings({ 
             ...settings, 
             globalPersona: { ...settings.globalPersona, diaries: updatedDiaries } 
          });
      }
      setContextMenu(null);
  };

  const handleEditUserDiaryStart = () => {
      if (!contextMenu) return;
      const entry = settings.globalPersona.diaries.find(d => d.id === contextMenu.id);
      if (entry) {
          setMyDiaryTitle(entry.title);
          setMyDiaryContent(entry.content);
          setEditingDiaryId(entry.id);
          setIsWritingMyDiary(true);
      }
      setContextMenu(null);
  };

  const toggleExpand = (entryId: string) => {
      if (!selectedChar) return;
      const updatedDiaries = selectedChar.diaries.map(d => 
          d.id === entryId ? { ...d, isExpanded: !d.isExpanded } : d
      );
      const updatedChar = { ...selectedChar, diaries: updatedDiaries };
      onUpdateCharacters(characters.map(c => c.id === selectedChar.id ? updatedChar : c));
  };

  // --- My Diary Logic ---

  const handleSaveMyDiary = () => {
      if (!myDiaryTitle || !myDiaryContent) {
          alert("请填写标题和正文");
          return;
      }
      
      let updatedDiaries;
      if (editingDiaryId) {
          // Update existing
          updatedDiaries = settings.globalPersona.diaries.map(d => 
              d.id === editingDiaryId ? { ...d, title: myDiaryTitle, content: myDiaryContent, timestamp: Date.now() } : d
          );
      } else {
          // Create new
          const newEntry: UserDiaryEntry = {
              id: Date.now().toString(),
              timestamp: Date.now(),
              title: myDiaryTitle,
              content: myDiaryContent,
              weather: '自填', 
              mood: '自填',
              peeks: [],
              isExpanded: false
          };
          updatedDiaries = [newEntry, ...(settings.globalPersona.diaries || [])];
      }
      
      onUpdateSettings({ 
          ...settings, 
          globalPersona: { ...settings.globalPersona, diaries: updatedDiaries } 
      });
      
      setIsWritingMyDiary(false);
      setEditingDiaryId(null);
      setMyDiaryTitle('');
      setMyDiaryContent('');
  };

  const toggleMyDiaryExpand = (entryId: string) => {
      const updatedDiaries = settings.globalPersona.diaries.map(d => 
        d.id === entryId ? { ...d, isExpanded: !d.isExpanded } : d
      );
      onUpdateSettings({ 
          ...settings, 
          globalPersona: { ...settings.globalPersona, diaries: updatedDiaries } 
      });
  };

  const handleInvitePeek = async (charId: string) => {
      if (!peekModalEntryId) return;
      if (!settings.apiKey) { alert("需要 API Key"); return; }
      
      const targetChar = characters.find(c => c.id === charId);
      const entry = settings.globalPersona.diaries.find(d => d.id === peekModalEntryId);
      
      if (!targetChar || !entry) return;
      
      setIsGenerating(true);
      setGeneratingCharName(targetChar.remark);
      
      const userName = targetChar.useLocalPersona ? targetChar.userMaskName : settings.globalPersona.name;
      const memories = targetChar.memories.map(m => `[长期记忆]: ${m.content}`).join('\n');
      const context = targetChar.contextMemory ? `[当前重要上下文]: ${targetChar.contextMemory}` : '';
      
      const prompt = interpolatePrompt(PEEK_PROMPT, {
          ai_name: targetChar.name,
          user_name: userName,
      }).replace('{diary_content}', entry.content) + `\n\n${context}\n\n${memories}`;
      
      try {
          const comment = await generateChatCompletion([{ role: 'user', content: prompt }], settings);
          
          const reaction: PeekReaction = {
              charId: targetChar.id,
              charName: targetChar.remark,
              charAvatar: targetChar.avatar,
              comment: comment,
              timestamp: Date.now()
          };
          
          // Update Global Persona state
          const updatedDiaries = settings.globalPersona.diaries.map(d => {
              if (d.id === peekModalEntryId) {
                  return { ...d, peeks: [...(d.peeks || []), reaction], isExpanded: true };
              }
              return d;
          });
          
          onUpdateSettings({ 
             ...settings, 
             globalPersona: { ...settings.globalPersona, diaries: updatedDiaries } 
          });
          setPeekModalEntryId(null); // Close modal
          
      } catch (e) {
          console.error(e);
          alert("偷窥请求失败");
      }
      setIsGenerating(false);
      setGeneratingCharName('');
  };

  return (
    <div className="h-full bg-[#fdfbf7] flex flex-col text-stone-800 font-serif relative">
       {/* Header */}
       <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-[#fdfbf7] sticky top-0 z-10 shadow-sm">
          <button onClick={() => selectedChar ? setSelectedCharId(null) : onClose()} className="w-8 h-8 rounded-full hover:bg-stone-200 flex items-center justify-center transition">
            <i className={`fas ${selectedChar ? 'fa-chevron-left' : 'fa-home'} text-stone-600`}></i>
          </button>
          
          <div className="flex bg-stone-200 rounded-lg p-1 text-xs font-bold">
              <button 
                onClick={() => { setActiveTab('CHARS'); setSelectedCharId(null); }}
                className={`px-3 py-1 rounded-md transition ${activeTab === 'CHARS' ? 'bg-white shadow text-stone-800' : 'text-stone-500'}`}
              >
                  角色日记
              </button>
              <button 
                onClick={() => { setActiveTab('MY_DIARY'); setSelectedCharId(null); }}
                className={`px-3 py-1 rounded-md transition ${activeTab === 'MY_DIARY' ? 'bg-white shadow text-stone-800' : 'text-stone-500'}`}
              >
                  我的日记
              </button>
          </div>

          <div className="w-8"></div>
       </div>

       {/* Content */}
       <div className="flex-1 overflow-y-auto p-4 scroll-smooth">
           
           {/* --- TAB: CHARACTER DIARIES --- */}
           {activeTab === 'CHARS' && (
               <>
                {!selectedChar ? (
                    // Character Selector
                    <div className="grid grid-cols-3 gap-4">
                        {characters.map(char => (
                            <button 
                                key={char.id} 
                                onClick={() => setSelectedCharId(char.id)}
                                className="flex flex-col items-center gap-2 group p-4 rounded-xl hover:bg-stone-100 transition"
                            >
                                <img src={char.avatar} className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md group-hover:scale-105 transition" />
                                <span className="text-sm font-bold text-stone-600">{char.remark}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    // Selected Character Diary List
                    <div className="space-y-6">
                        <div className="flex gap-2">
                            <button 
                                onClick={() => handleGenerateDiary()}
                                disabled={isGenerating}
                                className="flex-1 py-4 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-stone-400 hover:bg-stone-50 transition flex flex-col items-center justify-center gap-2"
                            >
                                {isGenerating ? (
                                    <div className="animate-spin text-2xl"><i className="fas fa-circle-notch"></i></div>
                                ) : (
                                    <>
                                        <i className="fas fa-pen-fancy text-xl"></i>
                                        <span className="font-bold">让 {selectedChar.remark} 写日记</span>
                                    </>
                                )}
                            </button>
                            <button 
                                onClick={() => setShowStyleSettings(true)}
                                className="w-16 border-2 border-stone-300 rounded-xl flex items-center justify-center text-stone-400 hover:bg-stone-50 hover:text-stone-600 transition"
                            >
                                <i className="fas fa-cog text-xl"></i>
                            </button>
                        </div>

                        {(selectedChar.diaries || []).map(entry => (
                            <div 
                                key={entry.id} 
                                onMouseDown={longPressEvents.onMouseDown(entry.id, 'CHAR')}
                                onMouseUp={longPressEvents.onMouseUp}
                                onMouseLeave={longPressEvents.onMouseLeave}
                                onTouchStart={longPressEvents.onTouchStart(entry.id, 'CHAR')}
                                onTouchEnd={longPressEvents.onTouchEnd}
                                onContextMenu={(e) => { e.preventDefault(); handleLongPress(entry.id, 'CHAR'); }}
                                className="bg-white shadow-md rounded-sm border-l-4 border-amber-800 overflow-hidden transition-all select-none"
                            >
                                {/* Header (Click to Toggle) */}
                                <div 
                                    onClick={() => toggleExpand(entry.id)}
                                    className="p-4 flex justify-between items-center cursor-pointer hover:bg-stone-50"
                                >
                                    <div>
                                        <div className="font-bold text-lg text-stone-800">{entry.title}</div>
                                        <div className="text-xs text-stone-400 mt-1">
                                            {new Date(entry.timestamp).toLocaleString()}
                                        </div>
                                    </div>
                                    <i className={`fas fa-chevron-down transition-transform text-stone-400 ${entry.isExpanded ? 'rotate-180' : ''}`}></i>
                                </div>

                                {/* Expanded Content */}
                                {entry.isExpanded && (
                                    <div className="p-6 pt-0 border-t border-stone-100 animate-fade-in">
                                        <div className="flex gap-4 text-xs text-stone-500 font-sans mb-4 mt-4 bg-stone-50 p-2 rounded">
                                            <span><i className="fas fa-cloud mr-1"></i>{entry.weather}</span>
                                            <span><i className="fas fa-smile mr-1"></i>{entry.mood}</span>
                                        </div>
                                        <div className="leading-loose text-justify text-stone-700 whitespace-pre-wrap font-serif text-[15px]">
                                            {entry.content}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
               </>
           )}

           {/* --- TAB: MY DIARY --- */}
           {activeTab === 'MY_DIARY' && (
               <div className="space-y-6">
                   {!isWritingMyDiary ? (
                        <button 
                            onClick={() => { setIsWritingMyDiary(true); setEditingDiaryId(null); setMyDiaryTitle(''); setMyDiaryContent(''); }}
                            className="w-full py-4 bg-amber-800 text-white rounded-xl font-bold shadow-lg hover:bg-amber-900 transition flex items-center justify-center gap-2"
                        >
                            <i className="fas fa-edit"></i> 写日记
                        </button>
                   ) : (
                       <div className="bg-white p-4 rounded-xl shadow border border-stone-200 animate-slide-up">
                           <div className="flex justify-between items-center mb-2">
                               <h3 className="font-bold text-stone-600">{editingDiaryId ? '编辑日记' : '新日记'}</h3>
                           </div>
                           <input 
                                className="w-full text-lg font-bold border-b border-stone-200 pb-2 mb-4 focus:outline-none focus:border-amber-600 bg-transparent placeholder-stone-300"
                                placeholder="日记标题..."
                                value={myDiaryTitle}
                                onChange={e => setMyDiaryTitle(e.target.value)}
                           />
                           <textarea 
                                className="w-full h-40 resize-none focus:outline-none bg-transparent placeholder-stone-300 leading-relaxed"
                                placeholder="今天发生了什么..."
                                value={myDiaryContent}
                                onChange={e => setMyDiaryContent(e.target.value)}
                           />
                           <div className="flex gap-3 mt-4">
                               <button onClick={() => setIsWritingMyDiary(false)} className="flex-1 py-2 text-stone-500 hover:bg-stone-100 rounded">取消</button>
                               <button onClick={handleSaveMyDiary} className="flex-1 py-2 bg-amber-800 text-white rounded shadow">保存</button>
                           </div>
                       </div>
                   )}

                   {/* List */}
                   {(settings.globalPersona.diaries || []).map(d => (
                       <div 
                        key={d.id} 
                        onMouseDown={longPressEvents.onMouseDown(d.id, 'USER')}
                        onMouseUp={longPressEvents.onMouseUp}
                        onMouseLeave={longPressEvents.onMouseLeave}
                        onTouchStart={longPressEvents.onTouchStart(d.id, 'USER')}
                        onTouchEnd={longPressEvents.onTouchEnd}
                        onContextMenu={(e) => { e.preventDefault(); handleLongPress(d.id, 'USER'); }}
                        className="bg-white shadow-sm rounded-lg border border-stone-200 overflow-hidden select-none"
                       >
                           <div onClick={() => toggleMyDiaryExpand(d.id)} className="p-4 cursor-pointer hover:bg-stone-50 flex justify-between items-center">
                               <div>
                                   <div className="font-bold text-stone-800">{d.title}</div>
                                   <div className="text-xs text-stone-400 mt-1">{new Date(d.timestamp).toLocaleDateString()}</div>
                               </div>
                               <i className={`fas fa-chevron-down transition-transform text-stone-400 ${d.isExpanded ? 'rotate-180' : ''}`}></i>
                           </div>

                           {d.isExpanded && (
                               <div className="p-4 pt-0 border-t border-stone-100">
                                   <div className="mt-4 mb-4 whitespace-pre-wrap leading-relaxed text-stone-700">{d.content}</div>
                                   
                                   {/* Peek Reactions */}
                                   {d.peeks && d.peeks.length > 0 && (
                                       <div className="mt-6 space-y-3">
                                           <div className="text-xs font-bold text-stone-400 uppercase tracking-widest">偷窥记录</div>
                                           {d.peeks.map((peek, idx) => (
                                               <div key={idx} className="bg-stone-50 p-3 rounded-lg flex gap-3 items-start">
                                                   <img src={peek.charAvatar} className="w-8 h-8 rounded-full object-cover" />
                                                   <div>
                                                       <div className="text-xs font-bold text-stone-600 mb-1">{peek.charName} <span className="text-[10px] text-stone-400 font-normal">{new Date(peek.timestamp).toLocaleTimeString()}</span></div>
                                                       <div className="text-sm text-stone-600 italic">"{peek.comment}"</div>
                                                   </div>
                                               </div>
                                           ))}
                                       </div>
                                   )}

                                   {/* Peek Action */}
                                   <div className="mt-4 pt-4 border-t border-stone-100 flex justify-end">
                                       <button 
                                        onClick={() => setPeekModalEntryId(d.id)}
                                        className="text-xs text-amber-700 font-bold hover:underline flex items-center gap-1"
                                       >
                                           <i className="fas fa-user-secret"></i> 邀请角色偷窥
                                       </button>
                                   </div>
                               </div>
                           )}
                       </div>
                   ))}
               </div>
           )}

           {/* Peek Selection Modal */}
           {peekModalEntryId && (
               <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
                   <div className="bg-white rounded-xl p-4 w-full max-w-sm animate-slide-up shadow-2xl">
                       <h3 className="font-bold mb-4 text-center">谁来偷看日记?</h3>
                       <div className="grid grid-cols-3 gap-3 max-h-60 overflow-y-auto">
                           {characters.map(c => (
                               <button key={c.id} onClick={() => handleInvitePeek(c.id)} className="flex flex-col items-center gap-1 p-2 hover:bg-gray-100 rounded">
                                   <img src={c.avatar} className="w-10 h-10 rounded-full object-cover" />
                                   <span className="text-xs truncate w-full text-center">{c.remark}</span>
                               </button>
                           ))}
                       </div>
                       <button onClick={() => setPeekModalEntryId(null)} className="mt-4 w-full py-2 bg-gray-100 rounded text-gray-500 text-sm">取消</button>
                   </div>
               </div>
           )}

           {/* Context Menu Bottom Sheet */}
           {contextMenu && (
               <div className="absolute inset-0 z-50 bg-black/20 flex flex-col justify-end" onClick={() => setContextMenu(null)}>
                  <div className="bg-white rounded-t-2xl p-4 animate-slide-up space-y-2 shadow-2xl pb-8" onClick={e => e.stopPropagation()}>
                      <div className="text-center text-xs text-stone-400 mb-2 font-sans">日记操作</div>
                      
                      {contextMenu.type === 'CHAR' ? (
                          <>
                            <button onClick={() => handleGenerateDiary(contextMenu.id)} className="w-full py-3 bg-amber-50 rounded-xl font-bold text-amber-800 flex items-center justify-center gap-2">
                                <i className="fas fa-sync-alt"></i> 让TA重写
                            </button>
                            <button onClick={handleDeleteDiary} className="w-full py-3 bg-red-50 rounded-xl font-bold text-red-600 flex items-center justify-center gap-2">
                                <i className="fas fa-trash"></i> 删除日记
                            </button>
                          </>
                      ) : (
                          <>
                            <button onClick={handleEditUserDiaryStart} className="w-full py-3 bg-amber-50 rounded-xl font-bold text-amber-800 flex items-center justify-center gap-2">
                                <i className="fas fa-pen"></i> 编辑/修改
                            </button>
                            <button onClick={handleDeleteDiary} className="w-full py-3 bg-red-50 rounded-xl font-bold text-red-600 flex items-center justify-center gap-2">
                                <i className="fas fa-trash"></i> 删除日记
                            </button>
                          </>
                      )}
                      
                      <button onClick={() => setContextMenu(null)} className="w-full py-3 mt-2 bg-white border border-stone-200 rounded-xl font-bold text-stone-500">取消</button>
                  </div>
               </div>
           )}
           
           {/* Diary Style Settings Modal */}
           {showStyleSettings && selectedChar && (
               <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
                   <div className="bg-white rounded-xl p-4 w-full max-w-sm animate-slide-up shadow-2xl">
                       <h3 className="font-bold mb-2 text-stone-700">日记风格指导</h3>
                       <p className="text-xs text-stone-400 mb-4">指导 AI 如何写这篇日记（例如：傲娇、流水账、伤感...）</p>
                       <textarea 
                           className="w-full h-32 p-2 border border-stone-300 rounded bg-stone-50 text-sm focus:outline-none focus:border-amber-500 mb-4"
                           placeholder="在此输入指导，例如：请用非常生气的语气写，抱怨今天天气太热..."
                           value={selectedChar.diaryStyle || ''}
                           onChange={(e) => handleUpdateDiaryStyle(e.target.value)}
                       />
                       <button onClick={() => setShowStyleSettings(false)} className="w-full py-2 bg-amber-800 text-white rounded font-bold">完成</button>
                   </div>
               </div>
           )}

           {isGenerating && (
               <div className="absolute inset-0 bg-white/80 z-40 flex flex-col items-center justify-center">
                   <div className="animate-spin text-4xl text-amber-600 mb-2"><i className="fas fa-circle-notch"></i></div>
                   <div className="text-stone-600 font-bold">
                       {generatingCharName} {activeTab === 'MY_DIARY' ? '正在阅读并思考...' : '正在写日记...'}
                   </div>
               </div>
           )}
       </div>
    </div>
  );
};

export default DiaryApp;
