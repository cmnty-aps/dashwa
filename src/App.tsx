import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import ReCAPTCHA from 'react-google-recaptcha';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Phone, CheckCircle2, Copy, RefreshCw, Loader2, ShieldCheck, 
  Settings, LayoutDashboard, Zap, AlertTriangle, Smartphone, 
  Menu, X, Server, MessageSquare, Shield, Activity, User, Save, Cpu, Clock, LogOut,
  Users, Hash, Briefcase, Image, Trash2, Radio, Send, MessageCircle, Bot, Eye, EyeOff, Lock, Key, Plus
} from 'lucide-react';

  const AdminPanel = () => {
    const [loading, setLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isCheckingIp, setIsCheckingIp] = useState(true);
    const [clientIp, setClientIp] = useState('');
    const [newIp, setNewIp] = useState('');
    const [sessions, setSessions] = useState<any[]>([]);
    const [globalConfig, setGlobalConfig] = useState<any>({});
    const [configSaving, setConfigSaving] = useState(false);
    const [stats, setStats] = useState<{ visitors: number }>({ visitors: 0 });

    const checkAuth = async () => {
      setIsCheckingIp(true);
      try {
        const res = await fetch('/api/admin/check-auth');
        const data = await res.json();
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
        setClientIp(data.ip || '');
      } catch (e) {
        setIsAuthenticated(false);
      }
      setIsCheckingIp(false);
    };

    const handleLogout = () => {
      // With IP-only auth, logout just prevents current UX session but won't really "deauth" IP
      setIsAuthenticated(false);
    };

    useEffect(() => {
      checkAuth();
    }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/admin/sessions');
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setSessions([]);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      setGlobalConfig(data);
    } catch (e) {
      console.error(e);
    }
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(globalConfig)
      });
      if (res.ok) {
        alert('✅ Konfigurasi berhasil disimpan!');
      } else {
        alert('❌ Gagal menyimpan konfigurasi.');
      }
    } catch (e) {
      alert('❌ Error saat menyimpan konfigurasi.');
    }
    setConfigSaving(false);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSessions();
    fetchConfig();
    fetchStats();
    const interval = setInterval(() => {
      fetchSessions();
      fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleReset = async () => {
    const pass = prompt("⚠️ PERHATIAN: Ini akan menghapus SEMUA sesi pada server.\nKetik 'RESET' untuk konfirmasi:");
    if (pass?.toUpperCase() !== 'RESET') return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/admin/reset-all', { 
        method: 'POST'
      });
      if (res.ok) {
        alert('✅ Semua sesi berhasil dihapus.');
        fetchSessions();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ Gagal menghapus sesi: ${errData.error || res.statusText || 'Unknown Error'}`);
      }
    } catch (e) {
      alert("❌ Gagal menghapus sesi");
    }
    setLoading(false);
  };

  if (isCheckingIp) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#85C1E9] font-sans p-4">
        <div className="bg-white border-8 border-black p-8 max-w-sm w-full text-center shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-4">
          <Loader2 size={48} className="animate-spin text-blue-600" />
          <p className="font-black uppercase text-xl">Mengecek Akses...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isCheckingIp) {
    window.location.replace('/');
    return null;
  }

  return (
    <div className="min-h-[100dvh] bg-[#85C1E9] font-sans p-3 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div 
          className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 bg-[#AED6F1] border-x-4 border-b-4 border-black p-6 md:p-8 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] gap-4 relative overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 4% 100%)' }}
        >
          {/* Header Background Video with diagonal split */}
          <div 
            className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
            style={{ 
              clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
            }}
          >
            <video 
              autoPlay 
              muted 
              loop 
              playsInline 
              className="w-full h-full object-cover"
            >
              <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="relative z-10">
            <h1 className="text-xl md:text-3xl font-black uppercase tracking-tighter truncate w-full md:w-auto">Panel Admin</h1>
            <div className="text-sm font-bold flex gap-4 mt-1">
              <span>Sesi Aktif: {sessions.length}</span>
              <span className="flex items-center gap-1"><Users size={16} /> Visitor: {stats.visitors}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto relative z-10">
            <button onClick={() => { fetchSessions(); fetchStats(); }} className="flex-1 bg-black text-white p-2.5 md:p-3 font-bold uppercase hover:bg-gray-800 text-xs md:text-sm">Refresh</button>
            <button onClick={handleLogout} className="flex-1 bg-white border-4 border-black text-black p-2.5 md:p-3 font-bold uppercase hover:bg-gray-100 flex items-center justify-center gap-1 text-xs md:text-sm">
              <LogOut size={16} /> Keluar
            </button>
            <button onClick={handleReset} className="flex-1 bg-red-600 border-4 border-black text-white p-2.5 md:p-3 font-bold uppercase hover:bg-red-700 flex items-center justify-center gap-1 text-xs md:text-sm">
              <Trash2 size={16} /> Reset
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-black text-white border-4 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xs uppercase font-bold opacity-70">Total Aktif</h2>
            <p className="text-3xl font-black">{sessions.length}</p>
          </div>
          <div className="bg-white text-black border-4 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between">
            <div>
              <h2 className="text-xs uppercase font-bold text-gray-500">Status Server</h2>
              <p className="text-xl font-black uppercase text-green-600">Online</p>
            </div>
          </div>
        </div>

        <div className="bg-[#AED6F1] border-4 border-black p-4 md:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] mb-6">
          <div className="flex items-center gap-3 border-b-4 border-black pb-2 mb-4">
            <Settings size={24} className="text-black" />
            <h2 className="text-xl font-black uppercase">Global Bot Configuration</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Nama Bot Global</label>
              <input
                type="text"
                placeholder="Masukkan nama bot global..."
                value={globalConfig.botName || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, botName: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Share Channel Link</label>
              <input
                type="text"
                placeholder="Masukkan link saluran WhatsApp Anda..."
                value={globalConfig.channelLink || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelLink: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Share Channel Name</label>
              <input
                type="text"
                placeholder="Masukkan nama saluran Anda..."
                value={globalConfig.channelName || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelName: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Target Newsletter Context ID</label>
              <input
                type="text"
                placeholder="Masukkan ID context newsletter..."
                value={globalConfig.channelId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 1</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter pertama..."
                value={globalConfig.autoFollowChannelId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 2</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter kedua..."
                value={globalConfig.autoFollowChannelId2 || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId2: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 3</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter ketiga..."
                value={globalConfig.autoFollowChannelId3 || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId3: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Join Group JID</label>
              <input
                type="text"
                placeholder="Masukkan JID grup (Contoh: 123456@g.us)..."
                value={globalConfig.autoJoinGroupId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoJoinGroupId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Thumbnail URL</label>
              <input
                type="text"
                placeholder="Masukkan URL gambar thumbnail..."
                value={globalConfig.thumbnailUrl || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, thumbnailUrl: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Tako Username</label>
              <input
                type="text"
                placeholder="Masukkan username akun Tako Anda..."
                value={globalConfig.takoUsername || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, takoUsername: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Saweria User ID</label>
              <input
                type="text"
                placeholder="Masukkan User ID Saweria Anda..."
                value={globalConfig.saweriaUserId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, saweriaUserId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Neoxr API Key</label>
              <input
                type="text"
                placeholder="Default: CMNTY-BOT"
                value={globalConfig.neoxrApiKey || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, neoxrApiKey: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2 bg-white/50 p-4 border-2 border-black border-dashed mt-4">
              <label className="text-sm font-black uppercase text-red-600 flex items-center gap-2">
                <Shield size={16} /> 🛡️ IP Access Whitelist
              </label>
              <p className="text-[10px] font-bold text-gray-600 mb-3">Daftar alamat IP yang diizinkan mengakses panel ini.</p>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {globalConfig.allowedIPs && globalConfig.allowedIPs.length > 0 ? (
                  globalConfig.allowedIPs.map((ip: string) => (
                    <div key={ip} className="bg-black text-white px-3 py-1 flex items-center gap-2 font-mono text-xs border-2 border-black group">
                      <span>{ip}</span>
                      <button 
                        type="button"
                        onClick={() => {
                          if (ip === '160.19.86.23') return;
                          const filtered = globalConfig.allowedIPs.filter((item: string) => item !== ip);
                          setGlobalConfig({ ...globalConfig, allowedIPs: filtered });
                        }}
                        className={`hover:text-red-400 transition-colors ${ip === '160.19.86.23' ? 'opacity-30 cursor-not-allowed' : ''}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] font-bold text-gray-400 italic">Belum ada IP yang terdaftar.</p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Tambah alamat IP (Misal: 103.245.x.x)"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newIp) {
                        const current = globalConfig.allowedIPs || [];
                        if (!current.includes(newIp)) {
                          setGlobalConfig({ ...globalConfig, allowedIPs: [...current, newIp] });
                          setNewIp('');
                        }
                      }
                    }
                  }}
                  className="w-full bg-white border-4 border-black p-2 font-bold font-mono text-sm outline-none focus:bg-gray-50 h-10"
                />
                <button 
                  type="button"
                  onClick={() => {
                    if (newIp) {
                      const current = globalConfig.allowedIPs || [];
                      if (!current.includes(newIp)) {
                        setGlobalConfig({ ...globalConfig, allowedIPs: [...current, newIp] });
                        setNewIp('');
                      }
                    }
                  }}
                  className="bg-black text-white px-4 h-10 font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(59,130,246,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none active:translate-x-1.5 active:translate-y-1.5 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  ➕ TAMBAH
                </button>
              </div>

              <p className="text-[10px] font-black text-gray-500 mt-3 uppercase">IP Anda saat ini: <span className="text-black font-mono">{clientIp}</span></p>
            </div>
          </div>
          
          <button 
            onClick={saveConfig}
            disabled={configSaving}
            className="mt-4 w-full bg-black text-white p-3 font-bold uppercase transition hover:bg-gray-800 flex items-center justify-center gap-2 text-xs md:text-sm"
          >
            {configSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            <span className="truncate">Simpan Konfigurasi Global</span>
          </button>
        </div>

        {loading && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-black" size={32} />
              <h2 className="text-lg font-black uppercase tracking-tighter">Memproses...</h2>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <div key={s.deviceId} className="bg-[#AED6F1] border-4 border-black p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex items-start gap-4 hover:-translate-y-1 transition-transform group">
               <div className="w-16 h-16 border-2 border-black bg-gray-200 overflow-hidden flex-shrink-0">
                 <img src={s.user?.profilePic || 'https://via.placeholder.com/64'} alt="Profile" className="w-full h-full object-cover" />
               </div>
               <div className="overflow-hidden min-w-0 flex-1">
                  <h3 className="font-black text-lg truncate group-hover:text-purple-700 transition">
                    {(!s.user?.name || s.user.name.toLowerCase() === 'unknown') 
                        ? (s.user?.id?.split('@')[0] || 'Unknown') 
                        : s.user.name
                    }
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                      <p className="font-mono text-[10px] text-gray-600 truncate bg-gray-100 p-1 rounded-sm border border-black">{s.deviceId}</p>
                      <button 
                        onClick={() => {
                            navigator.clipboard.writeText(s.deviceId);
                            alert('Device ID disalin!');
                        }}
                        className="p-1 hover:bg-gray-200"
                        title="Salin ID"
                      >
                          <Copy size={12} />
                      </button>
                      <button 
                        onClick={async () => {
                            if (!confirm(`Hapus dan log out perangkat ${s.deviceId}?`)) return;
                            try {
                                const res = await fetch(`/api/logout?deviceId=${s.deviceId}`, { method: 'POST' });
                                if (res.ok) {
                                    alert('Perangkat berhasil dikeluarkan dari WhatsApp.');
                                    fetchSessions();
                                }
                            } catch (e) {
                                alert('Error mengeluarkan perangkat');
                            }
                        }}
                        className="p-1 hover:bg-red-200 text-red-600 ml-auto"
                        title="Keluarkan & Hapus Sesi"
                      >
                          <LogOut size={12} />
                      </button>
                  </div>
                  <p className="font-mono text-xs text-gray-600 truncate mt-1">{s.user?.id?.split('@')[0] || 'Unknown ID'}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                    <span className="text-[10px] font-bold uppercase">{s.status}</span>
                  </div>
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  if (window.location.pathname.startsWith('/p-cmnty')) {
    return <AdminPanel />;
  }

  const [deviceId] = useState<string>(() => {
    const saved = localStorage.getItem('bot_device_id');
    if (saved && saved.startsWith('device_')) return saved;
    const newId = 'device_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('bot_device_id', newId);
    return newId;
  });

  const [activeTab, setActiveTab] = useState<'overview' | 'pairing' | 'features' | 'settings'>('pairing');
  const [botStatus, setBotStatus] = useState<{ 
    connected: boolean; 
    sessionExists: boolean; 
    status?: 'disconnected' | 'connecting' | 'connected';
    memoryUsageMB?: number;
    uptimeSeconds?: number;
    user?: { id: string; name: string, profilePic?: string } | null;
    metrics?: { messagesProcessed: number, activeGroupsCount: number };
    logs?: { time: string, message: string, type: 'info' | 'warn' | 'error' | 'success' }[];
  }>({ connected: false, sessionExists: false });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isPhoneNumberVisible, setIsPhoneNumberVisible] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [localUptime, setLocalUptime] = useState(0);
  const [searchFeature, setSearchFeature] = useState('');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showFollowPopup, setShowFollowPopup] = useState(true);

  const initialDataFetchedRef = useRef(false);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("https://c.termai.cc/a147/8c6DsM.mp3");
    audio.preload = "auto";
    notificationAudioRef.current = audio;
  }, []);

  const [placeholderText, setPlaceholderText] = useState("");
  const targetText = "Suport semua nomer...";

  useEffect(() => {
    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % (targetText.length + 1);
      setPlaceholderText(targetText.substring(0, currentIndex));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const maskPhoneNumber = (num: string | undefined | null) => {
    if (!num) return '...';
    const clean = num.split('@')[0].replace(/[^0-9]/g, '');
    if (clean.length < 8) return clean;
    return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
  };


  // Mascot Slider State
  const mascotImages = [
    "https://c.termai.cc/i128/TJX8.jpg",
    "https://c.termai.cc/i101/bDwEx.jpg",
    "https://c.termai.cc/i179/ED9G.jpg",
    "https://c.termai.cc/i178/HT9I2FQ.jpg",
    "https://c.termai.cc/i123/SX2W.jpg",
    "https://c.termai.cc/i185/KdNY.jpg"
  ];
  const [currentMascotIndex, setCurrentMascotIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMascotIndex((prev) => (prev + 1) % mascotImages.length);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Config State
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    // Initial fetch
    fetchStatus();
    fetchConfig();

    // Set up rapid polling interval
    const interval = setInterval(() => fetchStatus(), 5000);
    return () => clearInterval(interval);
  }, []); // Run once on mount

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalUptime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' && !config) fetchConfig();
  }, [activeTab]);

  useEffect(() => {
    if (botStatus.connected && pairingCode) {
      setPairingCode(null);
      setActiveTab('overview');
    }
    // Block access to dashboard tabs if not connected AND no session exists.
    // If session exists (disconnected/connecting/connected), allow dashboard access.
    if (initialDataFetchedRef.current && !botStatus.sessionExists && ['overview', 'settings'].includes(activeTab)) {
      setActiveTab('pairing');
    }
  }, [botStatus.connected, botStatus.sessionExists, pairingCode, activeTab]);


  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/status?deviceId=${deviceId}`);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (res.ok && isJson) {
        const data = await res.json();
        
        // Sync local uptime with server uptime
        if (data.uptimeSeconds !== undefined) {
          setLocalUptime(data.uptimeSeconds);
        }

        if (!initialDataFetchedRef.current) {
          // If the server confirms a session exists, we go straight to dashboard
          if (data.sessionExists) {
            setActiveTab('overview');
          } else {
            // Otherwise ensure we are at pairing
            setActiveTab('pairing');
          }
          initialDataFetchedRef.current = true;
          setIsInitialLoad(false);
        }

        setBotStatus(prev => {
           // Prevent UI from flapping if backend is just doing a quick transparent reconnect
           if (prev.connected && data.status !== 'connected' && data.sessionExists) {
               return { ...data, connected: true, status: 'connected' };
           }
           return data;
        });
      }
    } catch (err: any) {
      console.warn('Backend is unreachable (perhaps restarting?):', err.message);
    } finally {
      if (!initialDataFetchedRef.current) {
        initialDataFetchedRef.current = true;
        setIsInitialLoad(false);
      }
    }
  };

  const handleReconnect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reconnect?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) fetchStatus();
    } catch (err) {
      console.error('Reconnect failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Apakah Anda yakin ingin keluar dan menghapus sesi?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logout?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) {
        setPairingCode(null);
        fetchStatus();
        setActiveTab('pairing');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPairing = async () => {
    setLoading(true);
    try {
      await fetch(`/api/logout?deviceId=${deviceId}`, { method: 'POST' });
      setPairingCode(null);
      setPhoneNumber('');
      await fetchStatus();
    } catch (err) {
      console.error('Cancel pairing failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSystem = async () => {
    if (!confirm('PERINGATAN: Ini akan menghapus SEMUA sesi dan mereset sistem bot secara paksa. Gunakan hanya jika terjadi error koneksi berulang (Error 440). Lanjutkan?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reset-system?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) {
        alert('Sistem berhasil direset. Silakan Refresh browser!');
        window.location.reload();
      } else {
        alert('Gagal mereset sistem.');
      }
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await fetch(`/api/config?deviceId=${deviceId}`);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (res.ok && isJson) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setConfigLoading(false);
    }
  };

  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      await fetch(`/api/config?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      alert('Config saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save config');
    } finally {
      setConfigLoading(false);
    }
  };

  const updateToggle = async (field: string, value: boolean | string, additionalFields?: Record<string, any>) => {
    if (!config) return;
    const updatedConfig = { ...config, [field]: value, ...additionalFields };
    setConfig(updatedConfig);
    try {
      await fetch(`/api/config?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
    } catch (err: any) {
      console.error('Gagal menyimpan otomatis:', err);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;

    let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '62' + formattedPhone.slice(1);
    }

    setLoading(true);
    setError(null);
    setPairingCode(null);

    try {
      const response = await fetch(`/api/pair?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: formattedPhone, 
          method: 'pairing-code'
        }),
      });

      const isJson = response.headers.get('content-type')?.includes('application/json');
      if (!isJson) {
        setError('Server error: received non-JSON response. You might be rate-limited.');
        return;
      }
      
      const data = await response.json();
      if (response.ok) {
        setPairingCode(data.code);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Helpers
  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (d > 0) return `${d}h ${h}m ${m}s`;
    return `${h}h ${m}m ${s}s`;
  };

  // UI Components
  const NavItem = ({ id, icon: Icon, label }: { id: typeof activeTab, icon: any, label: string }) => (
    <button
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
      className={`w-full flex items-center gap-3 px-3 py-3 font-serif text-xs md:text-sm transition-all duration-75 border-4 ${
        activeTab === id 
          ? 'bg-wa-accent text-black border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-y-1 -translate-x-1' 
          : 'bg-[#5DADE2] text-white border-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1'
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate uppercase font-black">{label}</span>
    </button>
  );

  if (isInitialLoad) {
    return (
      <div className="flex h-[100dvh] bg-[#85C1E9] text-black font-sans items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="flex flex-col items-center gap-4 border-8 border-black p-8 bg-[#AED6F1] shadow-[12px_12px_0px_0px_#ffffff] z-10 w-full max-w-sm mx-4 text-center">
          <Loader2 size={48} className="animate-spin text-black" />
          <h2 className="text-xl font-black uppercase">LOADING</h2>
          <p className="text-sm font-bold text-gray-600">Please waiting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] font-sans text-black overflow-hidden relative selection:bg-wa-accent selection:text-black pb-[env(safe-area-inset-bottom)]">
      
    <div className="lg:hidden fixed top-0 left-0 right-0 h-20 z-50 flex items-start justify-center pointer-events-none">
        <div 
          className="bg-[#85C1E9] border-x-4 border-b-4 border-black h-16 w-full flex items-center px-6 pointer-events-auto relative shadow-[0_4px_0_0_rgba(0,0,0,0.1)] overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 4% 100%)' }}
        >
            {/* Header Background Video with diagonal split */}
            <div 
              className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
              style={{ 
                clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
              }}
            >
              <video 
                autoPlay 
                muted 
                loop 
                playsInline 
                className="w-full h-full object-cover"
              >
                <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
              </video>
            </div>
            {/* Logo Stylized */}
            <div className="flex items-center gap-2 bg-wa-accent border-4 border-black px-2 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] -translate-x-1 relative z-10">
              <div className="w-5 h-5 flex items-center justify-center bg-white border-2 border-black rotate-3">
                 <Bot size={12} fill="gray" />
              </div>
              <span className="text-black font-black uppercase tracking-tighter text-[10px]">CMNTY</span>
            </div>
            
            {/* Marquee */}
            <div className="flex-1 overflow-hidden relative flex items-center h-full mask-image-gradient mx-2 z-10">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
                className="whitespace-nowrap font-marquee font-bold text-xs tracking-tight inline-flex"
              >
                <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
                <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
              </motion.div>
            </div>
    
            {/* Menu Button */}
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
              className={`p-1.5 border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0 relative z-10 ${isMobileMenuOpen ? 'bg-red-400' : 'bg-wa-accent'}`}
            >
              {isMobileMenuOpen ? <X size={18} className="text-black" /> : <Menu size={18} className="text-black" />}
            </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-[80vw] max-w-[280px] lg:w-72 bg-[#85C1E9] border-r-4 border-black transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative flex flex-col`}>
        <div 
          className="h-44 hidden lg:flex items-center px-4 md:px-6 border-b-4 border-black bg-[#AED6F1] text-black relative overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 94% 100%, 6% 100%)' }}
        >
          {/* Sidebar Header Background Video with diagonal split */}
          <div 
            className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
            style={{ 
              clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
            }}
          >
            <video 
              autoPlay 
              muted 
              loop 
              playsInline 
              className="w-full h-full object-cover"
            >
              <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="flex flex-col gap-3 w-full -mt-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-wa-accent flex items-center justify-center border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0 z-10 relative overflow-hidden group">
                <div className="flex items-center -space-x-1 transition-transform group-hover:scale-110">
                  <Bot size={22} fill="white" className="text-black" />
                  <Send size={20} className="-rotate-12 text-wa-accent fill-black" />
                </div>
              </div>
              <div className="flex flex-col select-none">
                <span className="text-2xl font-black uppercase tracking-tighter leading-none border-b-4 border-black bg-white px-1">CMNTY</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] bg-black text-wa-accent px-1">SYSTEM BOT</span>
              </div>
            </div>
            
            <div className="overflow-hidden relative flex items-center mask-image-gradient py-1 bg-white border-2 border-black">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
                className="whitespace-nowrap font-marquee font-bold text-[9px] tracking-widest uppercase inline-flex"
              >
                <span className="inline-block px-8">CMNTY BOT • AUTOMATION • FAST • SECURE • MODERN • </span>
                <span className="inline-block px-8">CMNTY BOT • AUTOMATION • FAST • SECURE • MODERN • </span>
              </motion.div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 py-6 md:px-4 md:py-8 mt-16 lg:mt-0 font-serif text-black flex flex-col overflow-y-auto">
          
          <div className="space-y-3 md:space-y-4">
            <NavItem id="features" icon={Shield} label="lihat fitur" />
            
            {botStatus.connected ? (
              <>
                <NavItem id="overview" icon={LayoutDashboard} label="Dashboard" />
              </>
            ) : (
              <div className="px-3 py-4 text-[10px] font-bold bg-amber-100 text-black pixel-border border-dashed text-center break-words leading-tight mt-3">
                Tautkan perangkat untuk akses dashboard
              </div>
            )}
          </div>
          
          <div className="pt-4 mt-4 md:mt-6 border-t-4 border-black border-dashed">
            <NavItem id="pairing" icon={Smartphone} label={botStatus.connected ? "Perangkat" : "tautkan perangkat"} />
          </div>
          
          <div className="mt-8 mb-4 flex-1 flex flex-col justify-end items-center px-2">
            <div 
              className="relative w-full max-w-[260px] mx-auto select-none pointer-events-none"
              onContextMenu={(e) => e.preventDefault()}
            >
              <img 
                src={mascotImages[currentMascotIndex]} 
                alt="Bot Mascot" 
                className="w-full h-auto object-contain pointer-events-none"
                loading="lazy"
                draggable={false}
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t-4 border-black bg-[#85C1E9]">
          <div className={`flex items-center gap-3 px-3 py-3 bg-white pixel-border pixel-shadow-sm`}>
            <div className={`w-3 h-3 md:w-4 md:h-4 shrink-0 border-2 border-black ${botStatus.connected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`}></div>
            <div className="flex flex-col font-serif overflow-hidden">
                <span className="text-sm md:text-xl font-bold truncate drop-shadow-[1px_1px_0px_#fff]">
                  {botStatus.connected 
                    ? ((!config?.botName || config.botName === 'Bot Matrix' || config.botName === 'Matrix Bot' || config.botName === 'CMNTY-BOT' || config.botName === 'unknown') 
                        ? (botStatus.user?.name && botStatus.user?.name !== 'unknown' ? botStatus.user.name : 'CMNTY-BOT') 
                        : config.botName) 
                    : 'TERPUTUS'}
                </span>
                {botStatus.connected && (
                <span className="text-[10px] md:text-xs opacity-60 truncate">
                  {botStatus.user?.id ? `+${maskPhoneNumber(botStatus.user.id.split('@')[0])}` : 'Connecting...'}
                  {botStatus.user?.name && botStatus.user.name !== "unknown" && ` (${botStatus.user.name})`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-16 lg:pt-0">
        <main className="w-full max-w-6xl mx-auto p-4 md:p-6 lg:p-10 relative z-10 min-h-full flex flex-col pt-6 md:pt-8 lg:pt-10">
          
          <AnimatePresence mode="wait">
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 w-full max-w-[100vw]">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">DASHBOARD</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Statistik Sistem Real-time</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 text-black">
                  {/* Card 1: User Profile & Session */}
                  <div className="bg-[#AED6F1] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-4 md:gap-6 md:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-12 h-12 md:w-16 md:h-16 bg-gray-200 text-black pixel-border border-2 flex items-center justify-center shrink-0 overflow-hidden relative group">
                        {botStatus.user?.profilePic ? (
                          <img 
                            src={botStatus.user.profilePic} 
                            alt="Profile" 
                            referrerPolicy="no-referrer" 
                            className="w-full h-full object-cover" 
                            onError={(e) => {
                                // If image fails, fallback to icon
                                e.currentTarget.style.display = 'none';
                                const next = e.currentTarget.nextElementSibling as HTMLElement;
                                if (next) next.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className={`${botStatus.user?.profilePic ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}>
                           <User size={24} className="md:w-8 md:h-8" />
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-mono text-[10px] text-gray-600 truncate bg-gray-100 p-1 rounded-sm border border-black">{deviceId}</p>
                            <button 
                              onClick={() => {
                                  navigator.clipboard.writeText(deviceId);
                                  alert('Device ID disalin!');
                              }}
                              className="p-1 hover:bg-gray-200 border border-black bg-white"
                              title="Salin Device ID"
                            >
                                <Copy size={10} />
                            </button>
                          </div>
                          
                          <div className="flex items-center gap-2 font-bold text-xs md:text-sm opacity-90 italic">
                               <Smartphone size={14} className="shrink-0 text-blue-600" />
                               <span className="truncate underline decoration-2 decoration-blue-200 underline-offset-2">
                                 {botStatus.user?.id ? '+' + maskPhoneNumber(botStatus.user.id.split('@')[0]) : 'Menghubungkan...'}
                               </span>
                               {botStatus.user?.name && botStatus.user.name !== "unknown" && (
                                 <span className="truncate ml-1 bg-black text-white px-1 -skew-x-12 inline-block not-italic text-[10px] md:text-xs">
                                   ({botStatus.user.name})
                                 </span>
                               )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-row gap-2 md:gap-4 mt-auto font-serif">
                      <button onClick={() => setActiveTab('settings')} className="pixel-button bg-blue-400 text-black p-2 flex justify-center text-lg md:text-xl item-center aspect-square shrink-0">
                        <Settings size={18} className="md:w-5 md:h-5" />
                      </button>
                      <button onClick={botStatus.connected ? handleLogout : () => setActiveTab('pairing')} disabled={loading} className="pixel-button flex-1 bg-red-400 text-white px-2 py-2 flex justify-center text-sm md:text-xl items-center gap-2 truncate">
                        {loading ? <Loader2 size={16} className="animate-spin" /> : botStatus.connected ? <><LogOut size={16} /><span className="truncate">LOGOUT</span></> : 'TAUTAN'}
                      </button>
                    </div>
                  </div>

                  {/* Card 2: Memory Usage */}
                  <div className="bg-[#facc15] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">MEMORI RAM</span>
                      <Cpu size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center items-baseline pt-2 md:pt-4">
                      <span className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">{botStatus.memoryUsageMB || 0}</span>
                      <span className="font-serif font-bold ml-1 md:ml-2 text-xl md:text-3xl">MB</span>
                    </div>
                  </div>
                  
                  {/* Card 3: Server Uptime */}
                  <div className="bg-[#4ade80] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">WAKTU AKTIF</span>
                      <Clock size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center pt-2 md:pt-4">
                      <span className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                        {formatUptime(localUptime)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:gap-6 mt-6 text-black">
                  {/* Network Stats */}
                  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                    <div className="bg-[#AED6F1] flex-1 text-black pixel-border pixel-shadow p-4 md:p-6 flex items-center justify-between hover:bg-blue-100 transition-colors">
                      <div className="overflow-hidden">
                        <div className="font-serif text-sm md:text-lg font-bold uppercase mb-1 truncate">TOTAL GRUP</div>
                        <div className="text-3xl md:text-5xl font-bold truncate">{botStatus.metrics?.activeGroupsCount || 0}</div>
                      </div>
                      <div className="w-12 h-12 md:w-16 md:h-16 shrink-0 bg-blue-400 pixel-border border-2 flex items-center justify-center">
                        <Users size={24} className="md:w-8 md:h-8" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* PAIRING TAB */}
            {activeTab === 'pairing' && (
              <motion.div key="pairing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex-1 flex flex-col justify-center w-full min-h-[85vh] lg:min-h-0 mx-auto w-full max-w-4xl px-2 sm:px-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10 items-center">
                  <div className="flex flex-col justify-center text-center lg:text-left mt-4 lg:mt-0 px-2 lg:px-0">
                    <div className="flex flex-col items-center lg:items-start mb-4 md:mb-8 self-center lg:self-start gap-2">
                      <div className="inline-flex items-center gap-2 bg-[#facc15] text-black pixel-border border-b-[4px] border-r-[4px] md:border-b-[6px] md:border-r-[6px] px-3 py-1.5 md:px-4 md:py-2 font-serif font-bold text-sm md:text-lg uppercase">
                        <ShieldCheck size={16} className="md:w-5 md:h-5" />
                        Privasi Terjamin
                      </div>
                      <p className="text-xs md:text-sm font-bold bg-white text-black pixel-border px-2 py-1 shadow-[2px_2px_0px_#000] max-w-sm text-center lg:text-left">
                        Enkripsi end-to-end langsung dari protokol WhatsApp resmi.
                      </p>
                    </div>
                    
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold leading-tight mb-4 md:mb-6 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000]">
                      MILIKI BOT WHATSAPP <br/> <span className="text-blue-600">ANDA SEKARANG.</span>
                    </h1>
                  </div>

                  <div className="bg-[#AED6F1] pixel-border p-4 md:p-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center w-full min-h-[350px] md:min-h-[450px] relative overflow-hidden">
                    <div 
                      className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none transition-opacity duration-500"
                      style={{ backgroundImage: `url(${mascotImages[currentMascotIndex]})` }}
                    />
                    <div className="relative z-10 w-full flex flex-col justify-center">
                    {pairingCode ? (
                      <div className="space-y-4 md:space-y-6 text-center w-full">
                        <div className="space-y-3 md:space-y-4">
                          <label className="font-serif text-sm md:text-xl font-bold uppercase block bg-black text-white py-1">
                            KODE RAHASIA
                          </label>
                          <div className="bg-gray-200 pixel-border p-4 sm:p-6 md:p-8 py-6 sm:py-8 md:py-10 flex flex-col items-center gap-4 md:gap-6 relative shadow-inner overflow-hidden">
                            <span className="font-serif text-4xl sm:text-5xl md:text-6xl tracking-widest md:tracking-[8px] text-black font-bold break-all whitespace-pre-wrap">
                              {pairingCode}
                            </span>
                            <button onClick={copyToClipboard} className="pixel-button bg-[#4ade80] text-black px-4 py-3 md:px-6 md:py-3 text-sm md:text-xl w-full flex items-center justify-center gap-2">
                              {copied ? <CheckCircle2 size={18} className="md:w-6 md:h-6" /> : <Copy size={18} className="md:w-6 md:h-6" />} 
                              {copied ? 'DISALIN!' : 'SALIN KODE'}
                            </button>
                          </div>
                        </div>

                        <div className="text-left space-y-2 md:space-y-3 bg-[#facc15] pixel-border p-3 md:p-4 text-black">
                          <span className="font-serif text-sm md:text-lg font-bold uppercase block border-b-4 border-black pb-2 mb-2 md:mb-4">
                            CARA PAKAI
                          </span>
                          <ol className="text-sm md:text-lg lg:text-xl space-y-2 font-bold pl-4 md:pl-6 list-decimal">
                            <li>Buka WA Ponsel &gt; Perangkat Tertaut</li>
                            <li>Pilih 'Tautkan Perangkat'</li>
                            <li>Pilih 'Tautkan dg Nomor Telepon'</li>
                          </ol>
                        </div>

                        <button onClick={handleCancelPairing} disabled={loading} className="pixel-button bg-red-400 text-black px-3 py-3 md:py-4 mt-2 text-xs sm:text-sm md:text-lg w-full flex items-center justify-center gap-1 md:gap-2">
                          {loading ? <Loader2 size={16} className="animate-spin md:w-5 md:h-5" /> : <RefreshCw size={16} className="shrink-0" />} BATAL & GANTI NOMOR PENGIRIM
                        </button>
                      </div>
                    ) : botStatus.sessionExists ? (
                      <div className="space-y-6 text-center py-6 md:py-8">
                        <div className={`w-16 h-16 md:w-24 md:h-24 border-4 border-black flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-[4px_4px_0px_0px_#000] ${botStatus.connected ? 'bg-[#4ade80]' : 'bg-gray-200'}`}>
                          {botStatus.connected ? <CheckCircle2 size={32} className="md:w-12 md:h-12" /> : <Loader2 size={32} className="animate-spin md:w-12 md:h-12" />}
                        </div>
                        
                        <div className="bg-white pixel-border p-3 md:p-4 text-black">
                          <h2 className="text-xl md:text-2xl font-serif font-bold mb-1 md:mb-2 uppercase">
                            {botStatus.connected ? 'BERHASIL' : 'MENGHUBUNGKAN...'}
                          </h2>
                          <p className="text-sm md:text-lg font-bold">
                            {botStatus.connected 
                              ? 'WhatsApp anda sukses terhubung dengan bot.'
                              : 'Bot terdeteksi sedang menyambung ulang ke jaringan...'}
                          </p>
                        </div>

                        <div className="pt-6 md:pt-8 flex flex-col gap-3 md:gap-4">
                          {(!botStatus.connected) && (
                            <>
                              <button onClick={handleReconnect} disabled={loading} className="pixel-button bg-[#facc15] text-black py-3 md:py-4 text-sm md:text-lg w-full flex justify-center items-center gap-2">
                                {loading ? <Loader2 size={16} className="animate-spin md:w-5 md:h-5" /> : <RefreshCw size={16} className="md:w-5 md:h-5" />} PAKSA HUBUNGKAN
                              </button>
                              <button onClick={handleLogout} disabled={loading} className="pixel-button bg-red-400 text-white py-3 md:py-4 text-sm md:text-lg w-full flex justify-center items-center gap-2">
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={18} />} HANCURKAN SESI & LOGOUT
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handlePair} className="space-y-6 md:space-y-8 w-full">
                        <div className="bg-black text-white p-3 md:p-4 pixel-border">
                          <h2 className="text-lg md:text-2xl font-serif font-bold uppercase mb-1 md:mb-2 italic">
                            MASUKKAN NOMOR
                          </h2>
                        </div>
                        
                        <div className="space-y-4 md:space-y-6">

                                <div className="relative">
                                    <Phone className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 md:w-6 md:h-6" />
                                    <input
                                    type={isPhoneNumberVisible ? "tel" : "password"}
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    name="phone-number-field"
                                    placeholder={placeholderText}
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                                    className={`w-full bg-white text-black placeholder:text-gray-500 border-4 border-black p-3 pl-10 md:p-4 md:pl-14 text-lg sm:text-xl md:text-2xl font-bold outline-none focus:bg-yellow-100 transition-colors shadow-[4px_4px_0px_0px_#000] ${!isPhoneNumberVisible ? 'mask-input' : ''}`}
                                    required
                                    disabled={loading}
                                    autoFocus
                                    autoComplete="one-time-code"
                                    data-lpignore="true"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setIsPhoneNumberVisible(!isPhoneNumberVisible)}
                                        className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black"
                                    >
                                        {isPhoneNumberVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
                                    </button>
                                </div>

                                <div className="flex justify-center w-full overflow-hidden mt-4 mb-2">
                                  <div className="transform scale-90 md:scale-100 origin-center">
                                    <ReCAPTCHA
                                      sitekey="6LdcWOcsAAAAAL42mYR87Wzi0lKm_c3rPhvR7Kje"
                                      onChange={(val) => setIsVerified(!!val)}
                                    />
                                  </div>
                                </div>

                                <div className="flex flex-col gap-3">
                                  <button
                                    type="submit"
                                    disabled={loading || !phoneNumber || !isVerified}
                                    className="pixel-button bg-[#3b82f6] disabled:bg-gray-400 text-white py-3 md:py-4 text-lg md:text-2xl w-full flex items-center justify-center gap-2 md:gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                  >
                                    {loading ? <Loader2 size={20} className="animate-spin md:w-6 md:h-6" /> : 'GET PAIRING CODE'}
                                  </button>
                                </div>
                          
                          {error && (
                            <div className="flex items-start gap-2 md:gap-4 text-black bg-red-400 pixel-border p-3 md:p-4 text-sm md:text-lg font-bold shadow-[4px_4px_0px_0px_#000]">
                              <AlertTriangle size={20} className="shrink-0 mt-0.5 md:w-6 md:h-6" />
                              <p>{error}</p>
                            </div>
                          )}
                        </div>
                      </form>
                    )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* FEATURES TAB */}
            {activeTab === 'features' && (
              <motion.div key="features" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 w-full">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">DAFTAR FITUR</h1>
                    <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Kumpulan fitur otomatisasi bot.</p>
                  </div>
                  
                  {/* Search Input */}
                  <div className="relative w-full md:w-80">
                    <input
                      type="text"
                      placeholder="cari fitur"
                      value={searchFeature}
                      onChange={(e) => setSearchFeature(e.target.value)}
                      className="w-full bg-[#AED6F1] pixel-border p-3 pl-10 md:p-4 md:pl-12 text-sm md:text-lg font-bold placeholder:text-black/40 focus:outline-none focus:ring-0"
                    />
                    <div className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                      <LayoutDashboard size={20} className="md:w-6 md:h-6" />
                    </div>
                    {searchFeature && (
                      <button 
                        onClick={() => setSearchFeature('')}
                        className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-black hover:scale-110 transition-transform"
                      >
                        <X size={20} className="md:w-6 md:h-6" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {[
                    { title: "Leave Group", cmd: ".leave <link?>", desc: "Keluarkan bot dari grup secara manual atau otomatis via link (Khusus Owner).", color: "bg-red-500 text-white" },
                    { title: "Group Intro", cmd: ".intro", desc: "Tampilkan pesan perkenalan lengkap dengan template botname, total member, dan waktu otomatis.", color: "bg-green-500 text-white" },
                    { title: "Set Intro", cmd: ".setintro <teks>", desc: "Kustomisasi pesan perkenalan member di grup untuk disesuaikan kebutuhan spesifik (Khusus Admin).", color: "bg-yellow-500 text-black" },
                    { title: "Reset Intro", cmd: ".resetintro", desc: "Kembalikan pesan perkenalan grup ke template bawaan sistem secara otomatis (Khusus Admin).", color: "bg-slate-500 text-white" },
                    { title: "Rules Group", cmd: ".rulesgrup", desc: "Menampilkan aturan/rules grup yang berlaku.", color: "bg-indigo-500 text-white" },
                    { title: "Set Rules Group", cmd: ".setrulesgrup <teks>", desc: "Set atau ubah aturan/rules grup kustom (Khusus Admin).", color: "bg-blue-600 text-white" },
                    { title: "Reset Rules Group", cmd: ".resetrulesgrup", desc: "Reset aturan grup kembali ke default sistem (Khusus Admin).", color: "bg-gray-600 text-white" },
                    { title: "Cek ID Grup", cmd: ".cekidgc [link]", desc: "Cek ID, info anggota, deskripsi, dan statistik dari grup WhatsApp (di dalam grup atau via link).", color: "bg-teal-700 text-white" },
                    { title: "Cek Aktif", cmd: ".cekonline", desc: "Cek siapa saja member yang sedang online, online baru-baru ini, atau sedang mengetik di grup.", color: "bg-green-600 text-white border border-green-500" },
                    { title: "Link Group", cmd: ".linkgc", desc: "Dapatkan tautan undangan (invite link) dari grup tempat bot berada (Khusus Admin).", color: "bg-amber-600 text-white" },
                    { title: "Reset Link Group", cmd: ".resetlinkgc", desc: "Reset atau buat ulang tautan undangan grup yang baru secara otomatis (Khusus Admin).", color: "bg-red-600 text-white" },
                    { title: "Top Chat Group", cmd: ".topchat", desc: "Tampilkan statistik peringkat anggota paling aktif chat di dalam grup.", color: "bg-violet-600 text-white" },
                    { title: "Mulai Absensi", cmd: ".mulaiabsen <keterangan>", desc: "Mulai sesi absen baru di grup (Khusus Admin).", color: "bg-blue-500 text-white" },
                    { title: "Tanda Hadir", cmd: ".absen", desc: "Mencatat kehadiran diri Anda pada sesi absen yang berlangsung.", color: "bg-green-500 text-white" },
                    { title: "Cek Kehadiran", cmd: ".cekabsen", desc: "Lihat daftar lengkap siapa saja yang sudah melakukan absen.", color: "bg-yellow-500 text-black" },
                    { title: "Hapus Absensi", cmd: ".hapusabsen", desc: "Hapus atau tutup sesi absen yang sedang berjalan (Khusus Admin).", color: "bg-red-500 text-white" },
                    { title: "YouTube Play", cmd: ".ytplay <pencarian>", desc: "Cari dan putar musik YouTube langsung di WhatsApp (Hanya Audio).", color: "bg-red-600 text-white" },
                    { title: "YouTube Play Video", cmd: ".ytplayvid <pencarian>", desc: "Cari dan download video YouTube (MP4) secara otomatis berdasarkan judul.", color: "bg-red-800 text-white" },
                    { title: "Instagram Download", cmd: ".ig <link>", desc: "Download video reels, foto, atau carousel dari Instagram secara instan.", color: "bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 text-white" },
                    { title: "CapCut Downloader", cmd: ".ccdl <link>", desc: "Download video capcut tanpa watermark langsung ke WhatsApp anda.", color: "bg-slate-800 text-white" },
                    { title: "GitHub Downloader", cmd: ".githubdl <user> <repo> <branch>", desc: "Download source code repository GitHub dalam format ZIP.", color: "bg-gray-800 text-white" },
                    { title: "Pinterest Search", cmd: ".pins <query>", desc: "Cari dan temukan inspirasi gambar aesthetic langsung dari Pinterest dalam bentuk album.", color: "bg-red-700 text-white" },
                    { title: "Spotify Play", cmd: ".splay <pencarian>", desc: "Cari dan putar musik Spotify favorit Anda secara otomatis di WhatsApp (Hanya Audio).", color: "bg-[#1DB954] text-white" },
                    { title: "NPM Search", cmd: ".npm <query>", desc: "Cari informasi package di registry NPM langsung melalui bot.", color: "bg-[#CB3837] text-white" },
                    { title: "Build MLBB", cmd: ".buildml <hero>", desc: "Dapatkan rekomendasi build item, emblem, dan strategi terbaik untuk hero Mobile Legends favorit Anda.", color: "bg-blue-600 text-white" },
                    { title: "Info Turnamen MLBB", cmd: ".infotourney", desc: "Dapatkan jadwal dan informasi turnamen Mobile Legends terbaru yang sedang atau akan berlangsung.", color: "bg-orange-600 text-white" },
                    { title: "Blue Archive Wiki", cmd: ".bluearchive-char <nama>", desc: "Informasi lengkap tentang karakter Blue Archive, termasuk profil, stats battle, dan skill set.", color: "bg-cyan-600 text-white" },
                    { title: "Berita Terkini", cmd: ".berita / .cnn / .cnbc", desc: "Dapatkan informasi berita terbaru dari berbagai sumber terpercaya seperti CNN, CNBC, Antara, dan SindoNews secara real-time.", color: "bg-blue-700 text-white" },
                    { title: "NGL Spam", cmd: ".spamngl <link>|<teks>|<jumlah>", desc: "Kirim pesan spam secara otomatis ke link NGL target dengan jumlah tertentu.", color: "bg-gradient-to-r from-orange-500 to-pink-500 text-white" },
                    { title: "Translate", cmd: ".translate <teks>", desc: "Terjemahkan teks ke bahasa Indonesia secara otomatis. Contoh: .translate I love you", color: "bg-blue-600 text-white" },
                    { title: "Auto Sholat", cmd: ".autosholat", desc: "Pengingat waktu sholat otomatis dengan adzan dan manajemen grup.", color: "bg-teal-600 text-white" },
                    { title: "Auto Read", cmd: ".autoread on/off", desc: "Fitur untuk otomatis menandai pesan sebagai sudah dibaca.", color: "bg-teal-500 text-white" },
                    { title: "WhatsApp Stalker", cmd: ".wastalk <nomor/tag>", desc: "Lihat informasi profil WhatsApp seseorang melalui nomor HP atau tag.", color: "bg-green-600 text-white" },
                    { title: "Hidetag", cmd: ".ht / .h", desc: "Tag semua member grup secara sembunyi (hidetag). Mendukung pesan teks, gambar, video, dan media lainnya.", color: "bg-indigo-600 text-white" },
                    { title: "Hidetag 2", cmd: ".h2 / .hidetag2", desc: "Hidetag dengan fakeQuoted styling.", color: "bg-indigo-700 text-white" },
                    { title: "Open Time", cmd: ".opentime <jam>", desc: "Membuka grup otomatis sesuai jam yang ditentukan (contoh: .opentime 06.00).", color: "bg-green-700 text-white" },
                    { title: "Close Time", cmd: ".closetime <jam>", desc: "Menutup grup otomatis sesuai jam yang ditentukan (contoh: .closetime 09.00).", color: "bg-red-700 text-white" },
                    { title: "Cek Time", cmd: ".cektime", desc: "Melihat jadwal buka/tutup grup yang telah diset.", color: "bg-blue-600 text-white" },
                    { title: "Del Open Time", cmd: ".delopentime", desc: "Hapus jadwal buka grup otomatis.", color: "bg-red-600 text-white" },
                    { title: "Del Close Time", cmd: ".delclosetime", desc: "Hapus jadwal tutup grup otomatis.", color: "bg-red-800 text-white" },
                    { title: "Open Group", cmd: ".open", desc: "Membuka akses kirim pesan untuk semua anggota grup. Contoh: .open", color: "bg-green-600 text-white" },
                    { title: "Close Group", cmd: ".close", desc: "Menutup akses kirim pesan (hanya admin). Contoh: .close", color: "bg-red-600 text-white" },
                    { title: "Kick Member", cmd: ".kick / .dor", desc: "Mengeluarkan member dari grup.", color: "bg-red-700 text-white" },
                    { title: "Promote Member", cmd: ".promote", desc: "Jadikan member menjadi admin grup.", color: "bg-yellow-600 text-black" },
                    { title: "Demote Member", cmd: ".demote", desc: "Memberhentikan admin menjadi member biasa.", color: "bg-slate-600 text-white" },
                    { title: "AFK System", cmd: ".afk <alasan>", desc: "Memberitahu orang lain jika anda sedang tidak aktif di grup. Contoh: .afk mau tidur", color: "bg-purple-600 text-white" },
                    { title: "TikTok Downloader", cmd: ".tt / .tiktok", desc: "Download video TikTok tanpa watermark dan slide gambar secara otomatis.", color: "bg-cyan-500 text-white" },
                    { title: "TikTok MP3", cmd: ".ttmp3 / .ttmusic", desc: "Ambil audio saja dari video TikTok favorit Anda.", color: "bg-fuchsia-500 text-white" },
                    { title: "YouTube MP3", cmd: ".ytmp3 <url>", desc: "Download audio YouTube secara cepat dengan kualitas tinggi.", color: "bg-red-700 text-white" },
                    { title: "YouTube MP4", cmd: ".ytmp4 <url>", desc: "Download video YouTube hingga resolusi 1080p.", color: "bg-red-600 text-white" },
                    { title: "Spotify Downloader", cmd: ".spdl <url>", desc: "Download lagu favorit Anda dari Spotify hanya dengan menempelkan link track.", color: "bg-green-600 text-white" },
                    { title: "Play TikTok", cmd: ".playtiktok <query>", desc: "Cari dan kirim satu video TikTok terbaik berdasarkan kata kunci yang Anda berikan.", color: "bg-pink-600 text-white" },
                    { title: "SnackVideo Downloader", cmd: ".svdl <url>", desc: "Download video SnackVideo favorit Anda tanpa watermark.", color: "bg-orange-500 text-white" },
                    { title: "Videy Downloader", cmd: ".videy <url>", desc: "Download video dari Videy.co secara instan.", color: "bg-slate-700 text-white" },
                    { title: "TeraBox Downloader", cmd: ".terabox <url>", desc: "Download file, video, atau gambar dari link TeraBox.", color: "bg-blue-500 text-white" },
                    { title: "Lyrics Search", cmd: ".lirik <judul>", desc: "Cari lirik lagu dari database lengkap beserta info artis dan album.", color: "bg-blue-600 text-white" },
                    { title: "Info Gempa BMKG", cmd: ".gempa", desc: "Dapatkan informasi gempa bumi terkini di Indonesia langsung dari data BMKG (Magnitudo, Lokasi, Peta).", color: "bg-orange-600 text-white" },
                    { title: "Info Cuaca", cmd: ".cuaca desa|kecamatan|provinsi", desc: "Cek prakiraan cuaca akurat dari BMKG untuk wilayah desa, kecamatan, dan provinsi tertentu.", color: "bg-sky-500 text-white" },
                    { title: "Blur Face", cmd: ".blurface (reply gambar)", desc: "Sensoring wajah dalam gambar secara otomatis menggunakan teknologi AI untuk privasi.", color: "bg-neutral-600 text-white" },
                    { title: "Sticker Maker", cmd: ".s / .sticker", desc: "Ubah gambar atau video menjadi stiker WhatsApp secara instan.", color: "bg-orange-500 text-white" },
                    { title: "Brat Sticker", cmd: ".brat <teks>", desc: "Buat sticker teks gaya 'Brat' yang viral secara instan.", color: "bg-indigo-500 text-white" },
                    { title: "Brat Animated", cmd: ".bratvid <teks>", desc: "Buat sticker teks 'Brat' versi animasi/GIF yang unik.", color: "bg-emerald-500 text-white" },
                    { title: "Brat Bahlil", cmd: ".bratbahlil <teks>", desc: "Buat sticker teks gaya 'Brat Bahlil' yang viral.", color: "bg-zinc-800 text-white" },
                    { title: "Brat Green", cmd: ".bratgreen <teks>", desc: "Buat sticker teks gaya 'Brat Green' dengan latar belakang ijo unik.", color: "bg-lime-500 text-black" },
                    { title: "Brat Cewek", cmd: ".bratcewek <teks>", desc: "Buat sticker teks gaya 'Brat' dengan latar belakang karakter cewek estetik.", color: "bg-pink-400 text-white" },
                    { title: "Brat Squidward", cmd: ".bratsquidward <teks>", desc: "Buat sticker teks gaya 'Brat' dengan latar belakang karakter Squidward estetik.", color: "bg-cyan-400 text-white" },
                    { title: "Sticker Pack", cmd: ".stickerpack <query>", desc: "Cari dan kirim sekumpulan sticker (pack) secara otomatis berdasarkan pencarian.", color: "bg-indigo-600 text-white" },
                    { title: "Pinterest Pack", cmd: ".pinpack <query>", desc: "Cari gambar Pinterest lalu jadikan sticker pack", color: "bg-green-600 text-white" },
                    { title: "Brat Patrick", cmd: ".bratpatrick <teks>", desc: "Buat sticker teks gaya 'Brat' dengan latar belakang karakter Patrick Star estetik.", color: "bg-rose-400 text-white" },
                    { title: "Quote Sticker", cmd: ".qc <warna> <text>", desc: "Buat sticker quote chat (QC) dengan berbagai pilihan warna latar belakang.", color: "bg-indigo-700 text-white" },
                    { title: "Facebook Downloader (Direct)", cmd: ".facebookdl <link>", desc: "Download video dari Facebook secara langsung ke WhatsApp.", color: "bg-blue-800 text-white" },
                    { title: "Web to ZIP", cmd: ".web2zip <url>", desc: "Konversi dan download seluruh isi website menjadi file ZIP secara otomatis.", color: "bg-blue-500 text-white" },
                    { title: "Threads Downloader", cmd: ".tdl <url>", desc: "Download koleksi foto (album) dari postingan Threads secara otomatis.", color: "bg-black text-white border border-zinc-800" },
                    { title: "MediaFire Downloader", cmd: ".mfdl <link>", desc: "Download file dari MediaFire secara langsung ke WhatsApp.", color: "bg-blue-500 text-white" },
                    { title: "Brat Animated V2", cmd: ".bratvid2 <teks>", desc: "Buat sticker teks gaya 'Brat' dengan animasi kedip yang viral.", color: "bg-zinc-900 text-white border border-zinc-700" },
                    { title: "Emoji Mix", cmd: ".emojimix 😂🔥", desc: "Gabungkan 2 emoji menjadi 1 sticker unik secara otomatis.", color: "bg-yellow-400 text-black" },
                    { title: "Sticker Watermark", cmd: ".swm <pack>|<author>", desc: "Ganti nama paket dan pembuat pada stiker yang sudah ada (reply stiker).", color: "bg-amber-600 text-white" },

                    { title: "IQC Maker", cmd: ".iqc <teks>", desc: "Buat gambar pesan chat (IQC) dari teks kustom secara otomatis.", color: "bg-blue-400 text-black" },
                    { title: "3D Render", cmd: ".to3d <gambar>", desc: "Ubah foto menjadi gaya 3D render ala Pixar/DreamWorks dengan AI.", color: "bg-purple-500 text-white" },
                    { title: "Chibi Style", cmd: ".tochibi <gambar>", desc: "Ubah gambar ke style Chibi yang lucu dengan AI.", color: "bg-pink-500 text-white" },
                    { title: "Black Style", cmd: ".toblack <gambar>", desc: "Ubah skin tone pada gambar menjadi lebih gelap atau hitam.", color: "bg-neutral-800 text-white" },
                    { title: "Gura Effect", cmd: ".gura", desc: "Terapkan filter Gawr Gura lucu ke foto Anda dengan teknologi AI.", color: "bg-[#0ea5e9] text-white" },
                    { title: "Wafat Card Creator", cmd: ".wafat <nama> | <tanggal> | <pesan>", desc: "Buat kartu ucapan duka cita kustom dengan foto pilihan.", color: "bg-neutral-900 text-white border border-neutral-700" },
                    { title: "Fake Call", cmd: ".fakecall <nama> | <durasi>", desc: "Buat gambar fake call WhatsApp kustom dengan avatar pilihan.", color: "bg-teal-500 text-white" },
                    { title: "Fake ML Profile", cmd: ".fakeml <nama>", desc: "Buat gambar profil Mobile Legends kustom.", color: "bg-[#2563eb] text-white" },
                    { title: "Fake FF", cmd: ".fakeff <text>", desc: "Buat gambar lobi Free Fire kustom dengan teks pilihan Anda.", color: "bg-[#f59e0b] text-white" },
                    { title: "Fake Bank Jago", cmd: ".fakebankjago <nama>,<nominal>", desc: "Buat gambar saldo Bank Jago kustom dengan nama dan nominal pilihan.", color: "bg-orange-400 text-black" },
                    { title: "Fake Developer", cmd: ".fakedev <nama>", desc: "Buat kartu profil developer kustom dengan foto Anda.", color: "bg-indigo-600 text-white" },
                    { title: "QRIS", cmd: ".qris", desc: "Tampilkan QRIS Dana untuk donasi/dukung developer.", color: "bg-red-500 text-white" },
                    { title: "Fake Story", cmd: ".fakestory <nama>", desc: "Buat fake Instagram story dengan satu gambar penuh dan avatar Anda.", color: "bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white" },
                    { title: "Pak Ustad", cmd: ".pakustad <pertanyaan>", desc: "Tanyakan apa saja kepada Pak Ustad dan dapatkan nasihat berupa gambar.", color: "bg-green-700 text-white" },
                    { title: "Baca Al-Quran", cmd: ".quran <surah>", desc: "Baca ayat Al-Quran lengkap dengan teks Arab, Latin, dan terjemahan bahasa Indonesia.", color: "bg-emerald-600 text-white" },
                    { title: "Murrotal Al-Quran", cmd: ".murrotal <surah>", desc: "Dengarkan lantunan ayat suci Al-Quran (Murottal) berdasarkan nama surah secara audio.", color: "bg-emerald-800 text-white" },
                    { title: "Math Renderer", cmd: ".math <latex>", desc: "Render rumus matematika (LaTeX) menjadi gambar otomatis.", color: "bg-indigo-700 text-white" },
                    { title: "Instagram Stalk", cmd: ".igstalk <username>", desc: "Cek detail akun Instagram seperti jumlah follower, postingan, dan bio.", color: "bg-fuchsia-600 text-white" },
                    { title: "Stalk ML", cmd: ".stalkml id|server", desc: "Cek detail data akun Mobile Legends kustom.", color: "bg-[#4338ca] text-white" },
                    { title: "Stalk Roblox", cmd: ".roblox <username>", desc: "Cek detail info akun pemain Roblox.", color: "bg-[#0ea5e9] text-white" },
                    { title: "Stalk Free Fire", cmd: ".stalkff <id>", desc: "Cek detail info akun pemain Free Fire.", color: "bg-[#f59e0b] text-white" },
                    { title: "TikTok Stalk", cmd: ".ttstalk <username>", desc: "Lihat informasi detail profil TikTok seperti pengikut, suka, dan bio.", color: "bg-pink-500 text-white" },
                    { title: "GitHub Stalk", cmd: ".gitstalk <username>", desc: "Lihat informasi detail profil GitHub seperti repositori, pengikut, dan bio.", color: "bg-gray-800 text-white" },
                    { title: "Pinterest Stalk", cmd: ".pinstalk <username>", desc: "Lihat informasi detail profil Pinterest seperti bio dan foto profil.", color: "bg-red-600 text-white" },
                    { title: "Stalk Genshin", cmd: ".genshin <uid>", desc: "Cek detail info akun pemain Genshin Impact.", color: "bg-[#6366f1] text-white" },
                    { title: "Hentai (NSFW)", cmd: ".hentai", desc: "Dapatkan gambar hentai secara acak untuk hiburan dewasa.", color: "bg-red-900 text-white border border-red-700" },
                    { title: "Kasedaiki (NSFW)", cmd: ".kasedaiki", desc: "Dapatkan gambar kasedaiki secara acak.", color: "bg-orange-900 text-white border border-orange-700" },
                    { title: "Gangbang (NSFW)", cmd: ".gangbang", desc: "Dapatkan gambar anime gangbang secara acak.", color: "bg-stone-900 text-white border border-stone-700" },
                    { title: "Meme Sticker", cmd: ".smeme <atas|bawah>", desc: "Buat sticker meme lucu dengan teks kustom di atas dan bawah.", color: "bg-amber-500 text-white" },
                    { title: "ATTP", cmd: ".attp <teks>", desc: "Buat sticker animasi ATTP dengan teks acak yang Anda inginkan.", color: "bg-teal-600 text-white" },
                    { title: "Susu Maker", cmd: ".susu", desc: "Ubah foto menjadi mockup kemasan susu kotak. Cara pakai: kirim gambar dengan caption .susu atau reply gambar dengan pesan .susu.", color: "bg-red-400 text-white" },
                    { title: "Susu Taro Maker", cmd: ".susutaro", desc: "Ubah foto menjadi mockup kemasan susu taro kotak. Cara pakai: kirim gambar dengan caption .susutaro atau reply gambar dengan pesan .susutaro.", color: "bg-purple-500 text-white" },
                    { title: "Support Bot", cmd: ".donate / .donasi", desc: "Dukungan, Support & Request Fitur untuk pengembangan bot lebih lanjut.\nContoh: .donasi", category: "Lainnya", color: "bg-red-500 text-white" },
                    { title: "Facebook Downloader (HD)", cmd: ".fb <url>", desc: "Download video dari Facebook dengan kualitas HD secara gratis.", color: "bg-blue-600 text-white" },
                    { title: "Cari Kode Pos", cmd: ".kodepos <keyword>", desc: "Cari kode pos Indonesia dari keyword lokasi dengan mudah. Contoh: .kodepos jakarta", color: "bg-amber-600 text-white" },
                    { title: "Kalkulator WR MLBB", cmd: ".kalkulatormlbb <total_match>|<wr_sekarang>|<wr_target>", desc: "Hitung berapa banyak win streak yang dibutuhkan untuk mencapai target winrate tertentu di Mobile Legends.", color: "bg-indigo-500 text-white" },
                    { title: "Track IP", cmd: ".trackip <target/domain/ip>", desc: "Mendapatkan informasi detail tentang IP atau Domain, termasuk lokasi, ISP, dan timezone.", color: "bg-emerald-600 text-white" },
                    { title: "Jadwal TV", cmd: ".jadwaltv <channel>", desc: "Cek jadwal acara TV hari ini untuk berbagai channel (MNCTV, RCTI, SCTV, dll). Contoh: .jadwaltv mnctv", color: "bg-blue-700 text-white" },
                    { title: "Jadwal Bola", cmd: ".jadwalbola", desc: "Melihat jadwal pertandingan sepak bola terbaru dari berbagai liga dunia.", color: "bg-green-700 text-white" },
                    { title: "Avengers Logo", cmd: ".avengers <teks1>|<teks2>", desc: "Buat logo keren bertema Avengers dengan dua teks kustom. Contoh: .avengers CMNTY|BOT", color: "bg-slate-900 text-white border border-slate-700" },
                    { title: "Bear Logo", cmd: ".bear <teks>", desc: "Buat efek teks bear style yang lucu dan menggemaskan. Contoh: .bear CMNTY", color: "bg-orange-700 text-white" },
                    { title: "Blackpink Logo", cmd: ".blackpink <teks>", desc: "Buat efek teks Blackpink style yang ikonik. Contoh: .blackpink CMNTY", color: "bg-pink-600 text-white" },
                    { title: "Cartoon Graffiti Logo", cmd: ".cartoon-graffiti <teks>", desc: "Buat efek teks Cartoon Graffiti style yang berwarna-warni dan artistik. Contoh: .cartoon-graffiti CMNTY", color: "bg-yellow-600 text-white" },
                    { title: "Comic Logo", cmd: ".comic <teks>", desc: "Buat efek teks gaya komik (Comic Style) yang seru. Contoh: .comic CMNTY", color: "bg-red-500 text-white" },
                    { title: "Glitch Logo", cmd: ".glitch <teks>", desc: "Buat efek teks Glitch Digital style yang futuristik dan keren. Contoh: .glitch CMNTY", color: "bg-indigo-600 text-white" },
                    { title: "Mascot Logo", cmd: ".mascot <t1>|<t2>|<style>", desc: "Buat logo avatar mascot style dengan dua teks dan 92 pilihan style. Contoh: .mascot CMNTY|BOT|cobra", color: "bg-blue-800 text-white" },
                    { title: "Naruto Logo", cmd: ".naruto <teks>", desc: "Buat efek teks Naruto style yang ikonik. Contoh: .naruto CMNTY", color: "bg-orange-600 text-white" },
                    { title: "Pixel Glitch Logo", cmd: ".pixel-glitch <teks>", desc: "Buat efek teks Pixel Glitch style yang unik dan artistik. Contoh: .pixel-glitch CMNTY", color: "bg-fuchsia-600 text-white" },
                    { title: "Pornhub Logo", cmd: ".pornhub <t1>|<t2>", desc: "Buat logo ala Pornhub dengan dua teks kustom. Contoh: .pornhub CMNTY|BOT", color: "bg-yellow-500 text-black shadow-lg" },
                    { title: "Random Anime", cmd: ".anime", desc: "Dapatkan gambar karakter anime waifu acak yang cantik. Contoh: .anime", color: "bg-indigo-400 text-white" },
                    { title: "Blue Archive", cmd: ".blue-archive", desc: "Dapatkan gambar random karakter dari game Blue Archive. Contoh: .blue-archive", color: "bg-sky-400 text-white" },
                    { title: "Cecan China", cmd: ".cecan-china", desc: "Dapatkan gambar random cecan dari China yang menawan. Contoh: .cecan-china", color: "bg-red-500 text-white" },
                    { title: "Cecan Indo", cmd: ".cecan-indo", desc: "Dapatkan gambar random cecan dari Indonesia yang cantik. Contoh: .cecan-indo", color: "bg-green-500 text-white" },
                    { title: "Cecan Japan", cmd: ".cecan-japan", desc: "Dapatkan gambar random cecan dari Jepang yang kawaii. Contoh: .cecan-japan", color: "bg-pink-400 text-white" },
                    { title: "Cecan Korea", cmd: ".cecan-korea", desc: "Dapatkan gambar random cecan dari Korea yang memesona. Contoh: .cecan-korea", color: "bg-blue-400 text-white" },
                    { title: "Cecan Thailand", cmd: ".cecan-thailand", desc: "Dapatkan gambar random cecan dari Thailand yang eksotis. Contoh: .cecan-thailand", color: "bg-amber-500 text-white" },
                    { title: "Cecan Vietnam", cmd: ".cecan-vietnam", desc: "Dapatkan gambar random cecan dari Vietnam yang manis. Contoh: .cecan-vietnam", color: "bg-emerald-500 text-white" },
                    { title: "Random Loli", cmd: ".loli", desc: "Dapatkan gambar loli acak yang imut dan menggemaskan. Contoh: .loli", color: "bg-purple-400 text-white" },
                    { title: "Random Pap", cmd: ".pap", desc: "Dapatkan gambar pap acak yang cantik. Contoh: .pap", color: "bg-rose-400 text-white" },
                    { title: "Emoji to GIF Sticker", cmd: ".emojigif <emoji>", desc: "Ubah emoji menjadi stiker GIF animasi dengan mudah. Contoh: .emojigif 😭", color: "bg-pink-500 text-white" },
                    { title: "Donate Tako", cmd: ".tako <amount>|<message>", desc: "Buat pembayaran Tako untuk donasi.", color: "bg-teal-500 text-white" },
                    { title: "Donate Saweria", cmd: ".saweria <amount>|<message>", desc: "Buat pembayaran Saweria untuk donasi.", color: "bg-orange-500 text-white" },
                    { title: "Fake Dana", cmd: ".fakedana <nominal>", desc: "Buat gambar bukti saldo DANA palsu yang realistis.", color: "bg-blue-500 text-white" },
                    { title: "Nulis Buku", cmd: ".nulis <teks>", desc: "Ubah teks menjadi tulisan tangan di buku tulis secara otomatis.", color: "bg-stone-500 text-white" },
                    { title: "Remini / Enhance Image", cmd: ".remini (reply gambar)", desc: "Tingkatkan kualitas, ketajaman, dan resolusi gambar menjadi Full HD menggunakan bantuan AI.", color: "bg-purple-600 text-white" },
                    { title: "HD / Enhance Image v2", cmd: ".hd (reply gambar)", desc: "Tingkatkan kualitas gambar ke resolusi High Definition menggunakan algoritma AI terbaru.", color: "bg-indigo-600 text-white" },
                    { title: "HD Video / Enhance Video", cmd: ".hdvid (reply video)", desc: "Tingkatkan kualitas, ketajaman, dan resolusi video menjadi High Definition (HD) menggunakan bantuan AI.", color: "bg-emerald-600 text-white" },
                    { title: "Remove BG", cmd: ".removebg (reply gambar)", desc: "Hapus latar belakang dari foto Anda secara otomatis dengan hasil yang rapi dan bersih.", color: "bg-pink-600 text-white" },
                    { title: "Sticker to Image", cmd: ".toimg", desc: "Ubah sticker WhatsApp menjadi gambar biasa secara instan.", color: "bg-sky-500 text-white" },
                    { title: "Cek ID Channel", cmd: ".idch <link channel>", desc: "Dapatkan ID unik Saluran WhatsApp dari tautan undangan (Invite Link).", color: "bg-blue-600 text-white" },
                    { title: "IP Lookup", cmd: ".ipwho <ip>", desc: "Cek detail informasi lokasi, koordinat, ISP, dan keamanan alamat IP.", color: "bg-slate-700 text-white" },
                    { title: "DNS Lookup", cmd: ".lookup <domain>", desc: "Cek rekaman DNS (A, MX, NS, TXT) dan informasi WHOIS sebuah domain.", color: "bg-cyan-700 text-white" },
                    { title: "QR Custom", cmd: ".qrcustom <teks>", desc: "Generate QR Code custom dengan logo di tengah (reply foto untuk logo).", color: "bg-orange-600 text-white" },
                    { title: "Read More", cmd: ".readmore <teks>|<tab>", desc: "Membuat teks 'Baca selengkapnya' untuk menyembunyikan pesan di WhatsApp.", color: "bg-gray-800 text-white" },
                    { title: "Pastebin", cmd: ".pastebin <teks>", desc: "Upload teks atau kode Anda ke Pastebin secara instan dan dapatkan tautan URL-nya.", color: "bg-orange-500 text-white" },
                    { title: "PTV (Circle Video)", cmd: ".ptv (reply video)", desc: "Kirim video sebagai pesan video bulat (PTV) yang unik.", color: "bg-emerald-600 text-white" },
                    { title: "SS Web", cmd: ".ssweb <url>", desc: "Ambil screenshot tampilan website secara instan (desktop/mobile).", color: "bg-indigo-600 text-white" },
                    { title: "To URL (Uploader)", cmd: ".tourl <reply media>", desc: "Upload media (foto/video/audio) ke berbagai penyedia penyimpanan gratis dan dapatkan tautan URL-nya langsung.", color: "bg-teal-600 text-white" },
                    { title: "Anti Link WA", cmd: ".antilinkgc <on/off/metode>", desc: "Aktifkan perlindungan anti link WhatsApp di grup. Mendukung mode hapus pesan atau kick user.", color: "bg-red-600 text-white" },
                    { title: "Welcome Message", cmd: ".welcome <on/off>", desc: "Aktifkan pesan sambutan otomatis untuk member baru dengan kartu desain estetik.", color: "bg-teal-600 text-white" },
                    { title: "Goodbye Message", cmd: ".goodbye <on/off>", desc: "Aktifkan pesan perpisahan otomatis untuk member yang keluar dengan kartu desain estetik.", color: "bg-pink-600 text-white" },
                    { title: "Set Welcome", cmd: ".setwelcome <teks>", desc: "Kustomisasi pesan sambutan. Variabel: {user}, @group, {count}.", color: "bg-indigo-500 text-white" },
                    { title: "Set Goodbye", cmd: ".setgoodbye <teks>", desc: "Kustomisasi pesan perpisahan. Variabel: {user}, @group, {count}.", color: "bg-purple-500 text-white" },
                    { title: "Reset Welcome", cmd: ".resetwelcome", desc: "Reset pesan sambutan grup ke template bawaan sistem.", color: "bg-gray-500 text-white" },
                    { title: "Reset Goodbye", cmd: ".resetgoodbye", desc: "Reset pesan perpisahan grup ke template bawaan sistem.", color: "bg-zinc-500 text-white" },
                    { title: "Add Antilink", cmd: ".addantilink <domain>", desc: "Tambah domain kustom ke daftar blokir antilink di grup ini.", color: "bg-orange-600 text-white" },
                    { title: "Del Antilink", cmd: ".delantilink <domain>", desc: "Sebutkan atau hapus domain dari daftar blokir antilink kustom.", color: "bg-red-800 text-white" },
                    { title: "List Antilink", cmd: ".listantilink", desc: "Lihat semua link yang diblokir baik bawaan bot maupun kustom grup.", color: "bg-blue-800 text-white" },
                    { title: "Status Group (Owner)", cmd: ".swgc <teks>", desc: "Post Status/Story secara otomatis ke seluruh grup WhatsApp (khusus Owner).", color: "bg-green-700 text-white" },
                    { title: "Add Owner", cmd: ".addowner <@tag/nomor>", desc: "Berikan hak akses owner kepada nomor tertentu agar dapat menggunakan perintah khusus.", color: "bg-red-600 text-white" },
                    { title: "Del Owner", cmd: ".delowner <@tag/nomor>", desc: "Hapus hak akses owner dari nomor tertentu.", color: "bg-red-900 text-white" },
                    { title: "List Owner", cmd: ".listowner", desc: "Tampilkan daftar seluruh nomor yang memiliki akses owner.", color: "bg-gray-800 text-white" },
                    { title: "Vercel Deploy", cmd: ".deploy <nama>", desc: "Deploy website statis ke Vercel secara otomatis dari file ZIP atau kode HTML.", color: "bg-indigo-600 text-white" },
                    { title: "Read View Once", cmd: ".rvo", desc: "Buka dan simpan media 'Sekali Lihat' (View Once) baik itu foto, video, maupun voice note.", color: "bg-fuchsia-600 text-white" },
                    { title: "Ping (Speed)", cmd: ".ping", desc: "Uji kecepatan respon bot secara realtime.", color: "bg-lime-500 text-black" },
                    { title: "Self Mode", cmd: ".self", desc: "Mengaktifkan mode self (hanya owner & bot yang bisa akses)", color: "bg-red-500 text-white" },
                    { title: "Public Mode", cmd: ".public", desc: "Mengaktifkan mode public (semua user bisa akses).", color: "bg-green-500 text-white" },
                    { title: "Ban User", cmd: ".ban <nomor/@tag>", desc: "Memblokir user agar tidak bisa menggunakan bot.", color: "bg-red-800 text-white" },
                    { title: "Unban User", cmd: ".unban <nomor/@tag>", desc: "Menghapus pemblokiran user dari bot.", color: "bg-green-700 text-white" },
                    { title: "List Ban", cmd: ".listban", desc: "Melihat daftar user yang telah diblock.", color: "bg-red-400 text-white" },
                    { title: "Buat Grup", cmd: ".buatgrup <nama>|<nomor1,nomor2,...>", desc: "Membuat grup WhatsApp baru dari nomor kontak yang diberikan.", color: "bg-blue-600 text-white" },
                    { title: "Buat Saluran", cmd: ".buatsaluran <nama>|<deskripsi>", desc: "Buat saluran/newsletter WhatsApp baru.", color: "bg-teal-600 text-white" },
                    { title: "Upload Saluran", cmd: ".upch <id> <teks>", desc: "Upload media ke saluran WhatsApp.", color: "bg-teal-800 text-white" },
                    { title: "Join Grup", cmd: ".join <link>", desc: "Bot akan bergabung ke grup melalui link tautan undangan.", color: "bg-purple-600 text-white" },
                    { title: "Only Group", cmd: ".onlygc", desc: "Mengaktifkan mode hanya diakses di grup.", color: "bg-orange-500 text-white" },
                    { title: "Only Private", cmd: ".onlypc", desc: "Mengaktifkan mode hanya diakses di private chat.", color: "bg-indigo-500 text-white" },
                    { title: "Lock Group", cmd: ".onlythisgrup", desc: "Mengaktifkan mode hanya diakses di grup khusus ini saja.", color: "bg-red-900 text-white" },
                    { title: "Akankah", cmd: ".akankah <pertanyaan>", desc: "Tanya bot akankah sesuatu terjadi. Contoh: .akankah aku sukses?", color: "bg-pink-600 text-white" },
                    { title: "Apakah", cmd: ".apakah <pertanyaan>", desc: "Tanya bot apakah sesuatu. Contoh: .apakah aku bisa kaya?", color: "bg-fuchsia-600 text-white" },
                    { title: "Bagaimana", cmd: ".bagaimana <pertanyaan>", desc: "Tanya bot bagaimana sesuatu. Contoh: .bagaimana cara jadi sukses?", color: "bg-rose-600 text-white" },
                    { title: "Berapa", cmd: ".berapa <pertanyaan>", desc: "Tanya bot berapa sesuatu. Contoh: .berapa umur jodohku?", color: "bg-red-600 text-white" },
                    { title: "Bisakah", cmd: ".bisakah <pertanyaan>", desc: "Tanya bot bisakah sesuatu. Contoh: .bisakah aku lulus ujian?", color: "bg-indigo-600 text-white" },
                    { title: "Cek Khodam", cmd: ".cekkhodam <nama/tag/reply>", desc: "Cek khodam diri sendiri atau orang lain melalui pesan bot. (Pesan suara otomatis)", color: "bg-emerald-600 text-white" },
                    { title: "Cek Pacar", cmd: ".cekpacar <nama/tag/reply>", desc: "Cek status hubungan seseorang dengan bot.", color: "bg-pink-600 text-white" },
                    { title: "Coba", cmd: ".coba <pertanyaan>", desc: "Coba tanyakan sesuatu ke bot. Contoh: .coba tebak apa yang aku pikirkan", color: "bg-teal-600 text-white" },
                    { title: "Confess", cmd: ".confess <nomor>|<pesan>", desc: "Kirim pesan anonim ke seseorang. Contoh: .confess 6281234567890|Hai kamu!", color: "bg-rose-500 text-white" },
                    { title: "Dimana", cmd: ".dimana <pertanyaan>", desc: "Tanya bot dimana sesuatu. Contoh: .dimana jodohku berada?", color: "bg-amber-600 text-white" },
                    { title: "Gay", cmd: ".gay", desc: "Cek siapa yang paling gay di grup ini. (Hanya untuk grup)", color: "bg-fuchsia-600 text-white" },
                    { title: "Haruskah", cmd: ".haruskah <pertanyaan>", desc: "Tanya bot haruskah melakukan sesuatu. Contoh: .haruskah aku menyatakan cinta?", color: "bg-orange-600 text-white" },
                    { title: "Jodoh", cmd: ".jodoh", desc: "Jodohkan 2 member random di grup dengan tingkat kecocokan. (Hanya untuk grup)", color: "bg-pink-500 text-white" },
                    { title: "Tebak Bendera", cmd: ".tebakbendera", desc: "Game menebak nama negara berdasarkan gambar bendera yang diberikan. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-yellow-600 text-white" },
                    { title: "Tebak Gambar", cmd: ".tebakgambar", desc: "Game menebak kata dari petunjuk gambar yang diberikan. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-purple-600 text-white" },
                    { title: "Lengkapi Kalimat", cmd: ".lengkapikalimat", desc: "Game melengkapi kalimat rumpang dengan kata yang benar. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-blue-700 text-white" },
                    { title: "Tebak Kata", cmd: ".tebakkata", desc: "Game menebak kata berdasarkan petunjuk yang diberikan. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-pink-600 text-white" },
                    { title: "Teka Teki", cmd: ".tekateki", desc: "Game menjawab teka teki untuk bersenang-senang. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-teal-600 text-white" },
                    { title: "Asah Otak", cmd: ".asahotak", desc: "Game asah otak tentang pengetahuan umum. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-fuchsia-600 text-white" },
                    { title: "Tebak Lagu", cmd: ".tebaklagu", desc: "Game menebak judul lagu dari potongan audio. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-purple-500 text-white" },
                    { title: "Tebak Hero ML", cmd: ".tebakheroml", desc: "Game menebak nama hero Mobile Legends dari suara/voice line-nya. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-yellow-500 text-white" },
                    { title: "Tebak Logo", cmd: ".tebaklogo", desc: "Game menebak nama brand atau aplikasi berdasarkan logo yang diberikan. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-orange-600 text-white" },
                    { title: "Tebak Game", cmd: ".tebakgame", desc: "Game menebak judul game berdasarkan potongan gambar yang diberikan. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-cyan-600 text-white" },
                    { title: "Tebak Kalimat", cmd: ".tebakkalimat", desc: "Game melengkapi kalimat rumpang menjadi kalimat yang benar. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-emerald-600 text-white" },
                    { title: "Cerdas Cermat", cmd: ".cerdascermat", desc: "Game cerdas cermat SD mata pelajaran matematika. Jawab dengan mereply pesan bot (a/b/c/d). (Leveling aktif!)", color: "bg-blue-600 text-white" },
                    { title: "Susun Kata", cmd: ".susunkata", desc: "Game menyusun kata dari huruf-huruf yang diacak. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-red-500 text-white" },
                    { title: "Siapakah Aku", cmd: ".siapakahaku", desc: "Game menebak identitas seseorang, hewan, atau benda. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-orange-500 text-white" },
                    { title: "Cak Lontong", cmd: ".caklontong", desc: "Game tebak-tebakan logika nyeleneh ala Cak Lontong. Jawab dengan mereply pesan bot. (Leveling aktif!)", color: "bg-lime-600 text-white" },
                     { title: "Daftar Menu", cmd: ".menu / .help", desc: "Tampilkan seluruh daftar perintah yang tersedia.", color: "bg-indigo-900 text-white" }
                  ]
                  .filter(f => 
                    (f.title.toLowerCase().includes(searchFeature.toLowerCase()) || 
                    f.cmd.toLowerCase().includes(searchFeature.toLowerCase()) ||
                    f.desc.toLowerCase().includes(searchFeature.toLowerCase()))
                  ).map((f) => (
                    <div key={f.title + f.cmd} className={`${f.color} pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 hover:-translate-y-1 hover:-translate-x-1 md:hover:-translate-y-2 md:hover:-translate-x-2 md:hover:shadow-[12px_12px_0px_0px_#000] transition-all`}>
                      <div className="flex items-center justify-between border-b-4 border-black pb-2 bg-white/50 px-2 rounded-sm mx-[-8px] mt-[-8px]">
                        <h3 className="font-serif font-bold text-lg md:text-xl uppercase truncate text-black">{f.title}</h3>
                        <ShieldCheck size={20} className="md:w-6 md:h-6 shrink-0 ml-2 text-black" />
                      </div>
                      <p className="text-sm sm:text-base md:text-xl font-bold text-black flex-1 bg-white/80 p-2 border-2 border-black break-words">{f.desc}</p>
                      <div className="mt-2 bg-black text-green-400 font-sans text-base md:text-xl p-2 pixel-border break-all">
                        &gt; {f.cmd}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* SETTINGS TAB */}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 max-w-3xl mx-auto w-full">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">PENGATURAN MESIN</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Tweak modifikasi inti sistem bot.</p>
                </div>
                
                {configLoading && !config ? (
                  <div className="flex items-center justify-center py-10 md:py-20 bg-white pixel-border shadow-[4px_4px_0px_0px_#000] md:shadow-[8px_8px_0px_0px_#000]">
                    <Loader2 size={32} className="animate-spin text-black md:w-12 md:h-12" />
                  </div>
                ) : (
                  <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] w-full flex flex-col">
                    <div className="bg-[#FF90E8] border-b-4 border-black p-4 md:p-6 flex items-center gap-4">
                      <Settings size={32} className="text-black" />
                      <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Konfigurasi Sistem</h2>
                    </div>

                    <div className="p-4 md:p-6 bg-white overflow-y-auto max-h-[70vh] space-y-8 custom-scrollbar">
                      
                      {/* SECTION: API KEYS */}
                      <div className="bg-[#4ade80] border-4 border-black p-4 md:p-6 shadow-[4px_4px_0px_0px_#000]">
                        <div className="flex items-center gap-3 border-b-4 border-black pb-3 mb-4">
                          <Key size={24} className="text-black" />
                          <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter">Integrasi Token</h3>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-black uppercase text-black bg-white border-2 border-black px-2 py-1 inline-block">Vercel Token</label>
                            <input
                              type="password"
                              placeholder="Masukkan token deploy Vercel..."
                              value={config?.vercelToken || ''}
                              onChange={(e) => setConfig({ ...config, vercelToken: e.target.value })}
                              className="w-full bg-white border-4 border-black p-3 font-bold focus:bg-green-100 outline-none font-mono tracking-widest shadow-[4px_4px_0px_0px_#000] active:shadow-none transition-all"
                            />
                            <div className="bg-white/70 border-l-4 border-black p-2 inline-block mt-2">
                              <p className="text-xs font-bold text-gray-800">Dibutuhkan untuk menjalankan perintah <code className="bg-gray-200 px-1">.deploy</code></p>
                            </div>
                          </div>
                          

                        </div>
                      </div>
                      
                    </div>
                    
                    <div className="bg-[#ff4911] p-4 md:p-6 border-t-4 border-black flex flex-col md:flex-row justify-between items-center gap-4 w-full">
                       <p className="text-white font-bold text-sm bg-black px-3 py-2">Pastikan data sudah benar.</p>
                       <button
                        onClick={saveConfig}
                        disabled={configLoading}
                        className="bg-[#facc15] border-4 border-black text-black py-3 px-8 text-xl font-black flex items-center justify-center gap-3 w-full md:w-auto hover:bg-[#bef264] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000] active:translate-y-0 active:translate-x-0 active:shadow-[2px_2px_0px_0px_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {configLoading ? <Loader2 size={24} className="animate-spin" /> : <Save size={24} />} 
                        <span>SIMPAN KONFIGURASI</span>
                      </button>
                    </div>
                  </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>

        {/* Follow Popup Notification */}
        <AnimatePresence>
          {showFollowPopup && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                className="bg-[#AED6F1] border-4 border-black p-6 w-full max-w-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative flex flex-col justify-center"
              >
                <button 
                  onClick={() => {
                    setShowFollowPopup(false);
                    if (notificationAudioRef.current) {
                      notificationAudioRef.current.currentTime = 0;
                      notificationAudioRef.current.play().catch(e => console.error("Audio play failed:", e));
                    }
                  }}
                  className="absolute -top-3 -right-3 z-10 bg-red-500 border-4 border-black p-1 hover:bg-red-600 transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  <X size={24} className="text-black stroke-[3]" />
                </button>
                <h2 className="text-xl font-black uppercase mb-4 text-center tracking-tight border-b-4 border-black pb-2">Notifikasi</h2>
                
                <div className="relative w-full aspect-square border-4 border-black bg-white mb-6 overflow-hidden flex justify-center items-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div 
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
                    style={{ backgroundImage: `url(${mascotImages[currentMascotIndex]})` }}
                  />
                </div>
                
                <p className="text-center font-bold text-sm mb-6 bg-white border-2 border-dashed border-black p-3">
                  Follow saluran WhatsApp untuk info update CMNTY BOT biar ga ketinggalan informasi.
                </p>
                
                <a 
                  href="https://whatsapp.com/channel/0029VbCox0f17Emr10Bdlj0V"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setShowFollowPopup(false)}
                  className="w-full bg-[#4ade80] text-black border-4 border-black p-3 font-black uppercase flex justify-center items-center gap-2 hover:bg-[#38bdf8] transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:translate-x-1 hover:shadow-none"
                >
                  Follow Saluran
                </a>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    );
  }
