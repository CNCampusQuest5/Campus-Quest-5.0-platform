import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const BACKEND = (import.meta as any).env?.VITE_API_URL || 'https://campus-quest-backend-mspi.onrender.com';
const API_URL = `${BACKEND}/admin`;
const DEMO_URL = `${BACKEND}/demo`;
const SOCKET_URL = BACKEND;

interface Team {
  id: string;
  name: string;
  violationCount: number;
  isPaused: boolean;
  isDisqualified: boolean;
  spiderSenseCharges: number;
  hintStage: number;
  solvedCount: number;
  legitimateSolvedCount?: number;
  bypassedCount?: number;
  latestVerdict: string;
  currentProblemId: string;
  submissionCount?: number;
  penalty?: number;
}

interface Submission {
  id: string;
  teamId: string;
  problemId: string;
  language: string;
  verdict: string;
  runtimeMs: number;
  createdAt: string;
}

interface ViolationAlert {
  teamId: string;
  type: string;
  timestamp: string;
  violationCount?: number;
}

interface PowerupLog {
  teamId: string;
  type: string;
  timestamp: string;
}

interface AnalyticsData {
  mostSolvedQuestion: string;
  mostFailedQuestion: string;
  mostBypassedQuestion: string;
  averageAttempts: number;
  averageRuntime: number;
  averageMemory: number;
  spiderSenseUsage: number;
  totalPowerupUsage: number;
  violationCount: number;
  fastestSolve: number;
}

interface DemoTeam {
  id: string;
  name: string;
  email: string;
}

export default function App() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [violations, setViolations] = useState<ViolationAlert[]>([]);
  const [powerups, setPowerups] = useState<PowerupLog[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [contestStatus, setContestStatus] = useState<string>('Unknown');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'monitoring' | 'leaderboard' | 'analytics' | 'demo'>('monitoring');
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const [demoTeams, setDemoTeams] = useState<DemoTeam[]>([]);
  const [selectedDemoTeam, setSelectedDemoTeam] = useState<string>('');
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);

  const [adminToken, setAdminToken] = useState<string | null>(
    () => sessionStorage.getItem('cq_admin_token') || null
  );
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Setup Axios globally when token is set
  useEffect(() => {
    if (adminToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${adminToken}`;
      sessionStorage.setItem('cq_admin_token', adminToken); // M2: persist
    }
  }, [adminToken]);

  // Fetch initial state
  const fetchData = useCallback(async () => {
    try {
      const teamsRes = await axios.get(`${BACKEND}/admin/teams`);
      setTeams(teamsRes.data);
      const subsRes = await axios.get(`${BACKEND}/admin/submissions`);
      setSubmissions(subsRes.data);
      const analyticsRes = await axios.get(`${BACKEND}/admin/analytics`);
      setAnalytics(analyticsRes.data);
      const statusRes = await axios.get(`${BACKEND}/admin/contest-status`);
      setContestStatus(statusRes.data?.status || 'NOT_STARTED');
    } catch (err: any) {
      console.error('Failed to load initial admin data:', err);
    }
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    fetchData();

    // Check demo mode status
    axios.get(`${DEMO_URL}/status`).then(res => {
      setDemoModeEnabled(res.data.enabled);
    }).catch(() => {});

    // Load both demo teams AND test teams into the selector
    Promise.all([
      axios.get(`${DEMO_URL}/teams`).catch(() => ({ data: [] })),
      axios.get(`${BACKEND}/api/test-teams`).catch(() => ({ data: [] })),
    ]).then(([demoRes, testRes]) => {
      // Test teams come first (these are the real login accounts)
      const testList = (testRes.data as any[]).map((t: any) => ({ id: t.id, name: `${t.name} (test)`, email: '' }));
      const demoList = (demoRes.data as DemoTeam[]);
      const merged = [...testList, ...demoList];
      setDemoTeams(merged);
      if (merged.length > 0) setSelectedDemoTeam(merged[0].id);
    });

    // Connect admin to live WebSocket updates
    const socket = io(SOCKET_URL, {
      auth: { adminSecret: adminToken }
    });

    socket.on('connect', () => {
      console.log('[Admin Socket] Connected to stream');
      socket.emit('join:admin');
      fetchData(); // pull fresh data on connection / reconnection
    });

    socket.on('admin:violation_alert', (alert: any) => {
      setViolations(prev => [
        { teamId: alert.teamId, type: alert.type, timestamp: new Date().toLocaleTimeString(), violationCount: alert.violationCount },
        ...prev.slice(0, 49),
      ]);
      fetchData();
    });

    socket.on('admin:powerup_used', (usage: any) => {
      setPowerups(prev => [
        { teamId: usage.teamId, type: usage.type, timestamp: new Date().toLocaleTimeString() },
        ...prev.slice(0, 49),
      ]);
      fetchData();
    });

    socket.on('submit:result', () => { fetchData(); });
    socket.on('demo:leaderboard_updated', () => { fetchData(); });
    socket.on('demo:contest_reset', () => { fetchData(); setContestStatus('NOT_STARTED'); });
    // WARN-1 fix: handle lobby state — admin sees LOBBY before RUNNING
    socket.on('contest:lobby_started', () => setContestStatus('LOBBY'));
    socket.on('contest:started', () => setContestStatus('RUNNING'));
    socket.on('contest:resumed', () => setContestStatus('RUNNING'));
    socket.on('contest:paused', () => setContestStatus('PAUSED'));
    socket.on('contest:ended', () => setContestStatus('ENDED'));

    return () => { socket.disconnect(); };
  }, [fetchData, adminToken]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const secret = loginInput.trim();
    if (!secret) {
      setLoginError('Secret required');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      // POST to /admin/login — backend validates the secret and returns 401 if wrong.
      // This is the canonical auth flow; the secret itself is used as the bearer token.
      await axios.post(`${API_URL}/login`, { secret });
      setAdminToken(secret);
    } catch (err: any) {
      if (err.response?.status === 401) {
        setLoginError('Invalid admin secret. Access denied.');
      } else {
        setLoginError('Backend unreachable — is the server running?');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  if (!adminToken) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <form onSubmit={handleLogin} className="bg-gray-800 p-8 rounded-lg shadow-xl w-96">
          <h2 className="text-2xl font-bold text-red-500 mb-6 text-center">Admin Access</h2>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Admin Secret</label>
            <input
              type="password"
              className="w-full bg-gray-700 text-white rounded px-3 py-2"
              value={loginInput}
              onChange={(e) => setLoginInput(e.target.value)}
            />
          </div>
          {loginError && <div className="text-red-500 text-sm mb-4">{loginError}</div>}
          <button type="submit" disabled={loginLoading} className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded">
            {loginLoading ? 'Verifying…' : 'Login'}
          </button>
        </form>
      </div>
    );
  }

  const handleAction = async (action: 'start' | 'begin' | 'pause' | 'resume' | 'stop' | 'reset') => {
    try {
      setError(null);
      let endpoint = '';
      if (action === 'start') endpoint = '/start-contest';
      else if (action === 'begin') endpoint = '/begin-coding';
      else if (action === 'pause') endpoint = '/pause-contest';
      else if (action === 'resume') endpoint = '/resume-contest';
      else if (action === 'stop') endpoint = '/emergency-stop';
      else if (action === 'reset') endpoint = '/reset-contest';
      await axios.post(`${API_URL}${endpoint}`);
      // Start transitions to LOBBY, begin transitions to RUNNING directly
      setContestStatus(action === 'stop' ? 'ENDED' : action === 'reset' ? 'NOT_STARTED' : action === 'start' ? 'LOBBY' : action === 'begin' || action === 'resume' ? 'RUNNING' : 'PAUSED');
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'An error occurred');
    }
  };

  const handleResumeTeam = async (teamId: string) => {
    try {
      setError(null);
      await axios.post(`${API_URL}/resume-team`, { teamId });
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to resume team');
    }
  };

  // ── Demo helpers ────────────────────────────────────────────────────────────
  const demoAction = async (
    endpoint: string,
    payload: Record<string, any> = {},
    label: string,
  ) => {
    setDemoLoading(label);
    setDemoStatus(null);
    try {
      const res = await axios.post(`${DEMO_URL}/${endpoint}`, payload);
      setDemoStatus(`✓ ${label}: ${res.data.message || 'Done'}`);
      fetchData();
    } catch (err: any) {
      setDemoStatus(`✗ ${label} failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setDemoLoading(null);
    }
  };

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'AC': return 'bg-green-100 text-green-700 border-green-300';
      case 'CE': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default:   return 'bg-red-100 text-red-700 border-red-300';
    }
  };

  const DemoButton = ({
    label, icon, onClick, color = 'slate',
  }: { label: string; icon: string; onClick: () => void; color?: string }) => {
    const colorMap: Record<string, string> = {
      green:  'bg-green-700 hover:bg-green-600 border-green-400',
      blue:   'bg-sky-700 hover:bg-sky-600 border-sky-400',
      amber:  'bg-amber-700 hover:bg-amber-600 border-amber-400',
      red:    'bg-red-700 hover:bg-red-600 border-red-400',
      purple: 'bg-purple-700 hover:bg-purple-600 border-purple-400',
      slate:  'bg-slate-700 hover:bg-slate-600 border-slate-500',
    };
    const cls = colorMap[color] || colorMap.slate;
    return (
      <button
        onClick={onClick}
        disabled={demoLoading !== null}
        className={`flex flex-col items-center gap-1.5 px-3 py-3 ${cls} border-2 text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-all shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed min-w-[100px]`}
        id={`demo-btn-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <span className="text-xl">{icon}</span>
        <span className="leading-tight text-center">{label}</span>
        {demoLoading === label && <span className="text-[8px] animate-pulse text-yellow-300">Working…</span>}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header Bar */}
        <header className="bg-slate-800 border-2 border-slate-700 p-5 rounded-none flex items-center justify-between shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div>
            <h1 className="text-2xl font-black tracking-widest text-red-500 uppercase">🕷 SPIDER-VISION ADMIN CONSOLE</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">REAL-TIME MULTIVERSE CONTEST STATE TELEMETRY</p>
          </div>
          <div className="flex items-center gap-4">
            {demoModeEnabled && (
              <div className="bg-yellow-900/60 border border-yellow-500 px-3 py-1.5 text-xs font-mono text-yellow-400 animate-pulse">
                ⚠ DEMO MODE ACTIVE
              </div>
            )}
            <div className="bg-slate-950 px-4 py-2 border border-slate-700 text-xs font-mono">
              CONTEST STATUS: <span className={`font-bold ${contestStatus === 'RUNNING' ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>{contestStatus.toUpperCase()}</span>
            </div>
          </div>
        </header>

        {/* Global Controls Grid */}
        <section className="bg-slate-800 border-2 border-slate-700 p-5 rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-black tracking-widest text-slate-300 uppercase">CONTEST CONTROLS</h2>
            {error && <span className="text-xs text-red-400 font-mono font-bold">⚠️ ERROR: {error}</span>}
          </div>
          <div className="flex flex-wrap gap-4">
            <button onClick={() => handleAction('start')} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none">
              Start Lobby
            </button>
            <button onClick={() => handleAction('begin')} className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black font-mono text-xs font-black uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none animate-pulse">
              🚀 Begin Coding
            </button>
            <button onClick={() => handleAction('pause')} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none">
              Pause Contest
            </button>
            <button onClick={() => handleAction('resume')} className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none">
              Resume Contest
            </button>
            <button onClick={() => handleAction('stop')} className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none">
              ⚠️ EMERGENCY STOP
            </button>
            <button onClick={() => handleAction('reset')} className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none">
              🔄 RESET ALL SCORES
            </button>
          </div>
        </section>

        {/* Navigation Tabs */}
        <div className="flex gap-4 border-b-2 border-slate-700 pb-2">
          {(['monitoring', 'leaderboard', 'analytics'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-mono text-xs font-bold uppercase border-2 transition-all ${activeTab === tab ? 'bg-red-500 text-white border-black shadow-[2px_2px_0_#000]' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
            >
              {tab === 'monitoring' ? 'Operations Monitoring' : tab === 'leaderboard' ? 'Championship Leaderboard' : 'Analytics & Telemetry'}
            </button>
          ))}
        {/* Demo Controls tab always shown */}
          <button
            onClick={() => setActiveTab('demo')}
            className={`px-4 py-2 font-mono text-xs font-bold uppercase border-2 transition-all ${activeTab === 'demo' ? 'bg-yellow-500 text-black border-black shadow-[2px_2px_0_#000]' : 'bg-yellow-900/40 text-yellow-400 border-yellow-700 hover:text-yellow-300'}`}
            id="demo-controls-tab"
          >
            ⚡ DEMO CONTROLS
          </button>
        </div>

        {activeTab === 'monitoring' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Team Monitoring Column */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <h3 className="text-sm font-black tracking-widest text-slate-300 uppercase mb-4">LIVE TEAMS MONITORING</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {teams.map(t => (
                    <div
                      key={t.id}
                      className={`border-2 p-4 bg-slate-900 shadow-[2px_2px_0_0_rgba(0,0,0,1)] flex flex-col justify-between ${t.isDisqualified ? 'border-red-600 bg-red-950/20' : t.isPaused ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700'}`}
                    >
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                          <span className="font-bold text-sm tracking-wide text-white">{t.name}</span>
                          <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 border ${t.isDisqualified ? 'bg-red-900 border-red-500 text-white' : t.isPaused ? 'bg-amber-900 border-amber-500 text-white' : 'bg-green-900 border-green-500 text-white'}`}>
                            {t.isDisqualified ? 'DQ' : t.isPaused ? 'PAUSED' : 'ACTIVE'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400 mt-2">
                          <div>Solved: <span className="text-white font-bold">{t.solvedCount}</span></div>
                          <div>Hint Stage: <span className="text-purple-400 font-bold">{t.hintStage}</span></div>
                          <div>Strikes: <span className={`font-bold ${t.violationCount > 2 ? 'text-red-400 animate-pulse' : 'text-slate-200'}`}>{t.violationCount}/5</span></div>
                          <div>Active: <span className="text-sky-400 font-bold">{t.currentProblemId.substring(0, 10)}</span></div>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2 justify-end">
                        {t.isPaused && !t.isDisqualified && (
                          <button
                            onClick={() => handleResumeTeam(t.id)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-mono text-[10px] font-bold uppercase border border-black shadow-[1px_1px_0_#000] active:translate-y-0.5 active:shadow-none"
                          >
                            Resume Team
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submissions Feed */}
              <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <h3 className="text-sm font-black tracking-widest text-slate-300 uppercase mb-4">LIVE SUBMISSIONS FEED</h3>
                <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                  {submissions.map(sub => (
                    <div key={sub.id} className="border border-slate-700 bg-slate-900 p-3 flex justify-between items-center font-mono text-xs">
                      <div>
                        <div className="flex gap-2">
                          <span className="font-bold text-white">{sub.teamId}</span>
                          <span className="text-slate-500">submitted</span>
                          <span className="text-sky-400 font-bold">{sub.problemId}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          Lang: {sub.language} • {new Date(sub.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="flex gap-3 items-center">
                        <span className="text-[10px] text-slate-400">{sub.runtimeMs}ms</span>
                        <span className={`border px-1.5 py-0.5 text-[10px] font-bold ${getVerdictBadge(sub.verdict)}`}>
                          {sub.verdict}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Side feeds */}
            <div className="space-y-6">
              <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <h3 className="text-sm font-black tracking-widest text-red-500 uppercase mb-4 flex items-center gap-2">⚠️ CHEAT DETECT ALERTS</h3>
                <div className="space-y-3 max-h-[250px] overflow-y-auto">
                  {violations.map((v, i) => (
                    <div key={i} className="border-l-4 border-red-500 bg-red-950/20 p-2.5 font-mono text-[11px]">
                      <div className="flex justify-between font-bold text-red-400">
                        <span>{v.teamId}</span><span>{v.timestamp}</span>
                      </div>
                      <p className="text-slate-300 mt-1 uppercase text-[10px]">VIOLATION: {v.type}</p>
                      {v.violationCount && <p className="text-slate-400 mt-0.5 text-[9px]">Strike Count: {v.violationCount}/5</p>}
                    </div>
                  ))}
                  {violations.length === 0 && <div className="text-center py-6 text-zinc-500 font-mono text-xs">No violations detected.</div>}
                </div>
              </div>

              <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <h3 className="text-sm font-black tracking-widest text-yellow-500 uppercase mb-4">⚡ POWERUP CONSUMPTION LOG</h3>
                <div className="space-y-3 max-h-[250px] overflow-y-auto">
                  {powerups.map((p, i) => (
                    <div key={i} className="border-l-4 border-yellow-500 bg-yellow-950/10 p-2.5 font-mono text-[11px]">
                      <div className="flex justify-between font-bold text-yellow-500">
                        <span>{p.teamId}</span><span>{p.timestamp}</span>
                      </div>
                      <p className="text-slate-300 mt-1 uppercase text-[10px]">Activated: {p.type}</p>
                    </div>
                  ))}
                  {powerups.length === 0 && <div className="text-center py-6 text-zinc-500 font-mono text-xs">No powerups activated.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="bg-slate-800 border-2 border-slate-700 p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
            <h3 className="text-sm font-black tracking-widest text-slate-300 uppercase mb-4">CHAMPIONSHIP LEADERBOARD</h3>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-700 text-slate-400 text-left">
                    <th className="pb-3 font-bold uppercase">Rank</th>
                    <th className="pb-3 font-bold uppercase">Team Name</th>
                    <th className="pb-3 font-bold uppercase text-center">Solves / Bypasses</th>
                    <th className="pb-3 font-bold uppercase text-center">Submissions</th>
                    <th className="pb-3 font-bold uppercase text-center">Penalty</th>
                    <th className="pb-3 font-bold uppercase text-right">Current Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {teams
                    .slice()
                    .sort((a, b) => b.solvedCount - a.solvedCount || (a.penalty ?? 0) - (b.penalty ?? 0))
                    .map((t, idx) => (
                      <tr key={t.id} className="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
                        <td className="py-3.5 font-black text-slate-400 text-sm">#{idx + 1}</td>
                        <td className="py-3.5 font-bold text-white text-sm">{t.name}</td>
                        <td className="py-3.5 text-center font-black text-sm">
                          <span className="text-green-400">{t.legitimateSolvedCount ?? t.solvedCount}</span>
                          <span className="text-slate-500 mx-1">/</span>
                          <span className="text-orange-400">{t.bypassedCount ?? 0}</span>
                        </td>
                        <td className="py-3.5 text-center text-slate-300">{t.submissionCount || 0}</td>
                        <td className="py-3.5 text-center text-red-400 font-bold">{t.penalty || 0} pts</td>
                        <td className="py-3.5 text-right font-semibold text-slate-400">
                          {t.isDisqualified ? <span className="text-red-500 font-bold uppercase">Disqualified</span>
                            : t.isPaused ? <span className="text-amber-500 font-bold uppercase">Locked Out</span>
                              : <span className="text-sky-400">{t.latestVerdict !== 'none' ? `Verdict: ${t.latestVerdict} (${t.currentProblemId.substring(0, 10)})` : 'Active'}</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && analytics && (
          <div className="bg-slate-800 border-2 border-slate-700 p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
            <h3 className="text-sm font-black tracking-widest text-slate-300 uppercase mb-4">CONTEST ANALYTICS & TELEMETRY</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Question Stats */}
              <div className="bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1">Missions</h4>
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Most Solved</span>
                    <span className="text-green-400 font-bold truncate max-w-[120px] ml-2">{analytics.mostSolvedQuestion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Most Bypassed</span>
                    <span className="text-yellow-400 font-bold truncate max-w-[120px] ml-2">{analytics.mostBypassedQuestion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Most Failed</span>
                    <span className="text-red-400 font-bold truncate max-w-[120px] ml-2">{analytics.mostFailedQuestion}</span>
                  </div>
                </div>
              </div>

              {/* Performance Stats */}
              <div className="bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1">Performance</h4>
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Runtime</span>
                    <span className="text-sky-400 font-bold">{analytics.averageRuntime} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Memory</span>
                    <span className="text-purple-400 font-bold">{analytics.averageMemory} KB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fastest Solve</span>
                    <span className="text-white font-bold">{analytics.fastestSolve} ms</span>
                  </div>
                </div>
              </div>

              {/* Engagement Stats */}
              <div className="bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1">Engagement</h4>
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Attempts</span>
                    <span className="text-white font-bold">{analytics.averageAttempts}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Spider-Sense Used</span>
                    <span className="text-yellow-400 font-bold">{analytics.spiderSenseUsage}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Powerups</span>
                    <span className="text-sky-400 font-bold">{analytics.totalPowerupUsage}</span>
                  </div>
                </div>
              </div>

              {/* Security Stats */}
              <div className="bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)] flex flex-col justify-between">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1">Security</h4>
                  <div className="font-mono text-xs text-center py-2">
                    <div className="text-slate-400 uppercase mb-1">Cheat Alerts</div>
                    <div className={`text-2xl font-black ${analytics.violationCount > 10 ? 'text-red-500 animate-pulse' : 'text-slate-300'}`}>{analytics.violationCount}</div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── DEMO CONTROLS TAB ── */}
        {activeTab === 'demo' && (
          <div className="space-y-6">

            {/* Demo mode disabled banner */}
            {!demoModeEnabled && (
              <div className="border-2 border-amber-600 bg-amber-950/30 p-5 font-mono text-sm text-amber-400">
                <div className="font-black uppercase tracking-widest mb-2">⚠️ DEMO MODE IS DISABLED</div>
                <div className="text-xs text-amber-300">
                  Set <code className="bg-black/40 px-1.5 py-0.5 rounded">DEMO_MODE=true</code> in{' '}
                  <code className="bg-black/40 px-1.5 py-0.5 rounded">apps/backend/.env</code> then restart the backend.
                </div>
              </div>
            )}

            {/* Status bar */}
            {demoStatus && (
              <div className={`border-2 p-3 font-mono text-xs ${demoStatus.startsWith('✓') ? 'border-green-600 bg-green-950/30 text-green-400' : 'border-red-600 bg-red-950/30 text-red-400'}`}>
                {demoStatus}
              </div>
            )}

            {/* Team selector */}
            <div className="bg-slate-800 border-2 border-yellow-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <h3 className="text-sm font-black tracking-widest text-yellow-400 uppercase mb-4">
                ⚡ DEMO CONTROLS — FOR PRESENTATIONS ONLY
              </h3>
              <div className="flex items-center gap-4 mb-2">
                <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">Active Team:</label>
                <select
                  value={selectedDemoTeam}
                  onChange={e => setSelectedDemoTeam(e.target.value)}
                  className="bg-slate-900 border-2 border-slate-600 text-white font-mono text-xs px-3 py-1.5 focus:border-yellow-500 outline-none"
                  id="demo-team-selector"
                >
                  {demoTeams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                  {teams
                    .filter(t => !demoTeams.find(d => d.id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name} (real)</option>
                    ))}
                </select>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                All actions use real backend endpoints. Nothing is faked on the frontend.
              </p>
            </div>

            {/* Progression controls */}
            <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <h4 className="text-xs font-black tracking-widest text-green-400 uppercase mb-4">📈 PROGRESSION SIMULATOR</h4>
              <div className="flex flex-wrap gap-3">
                <DemoButton label="Solve Current" icon="✅" color="green"
                  onClick={() => demoAction('solve-current', { teamId: selectedDemoTeam }, 'Solve Current')} />
                <DemoButton label="Solve Next" icon="⏭" color="green"
                  onClick={() => demoAction('solve-next', { teamId: selectedDemoTeam }, 'Solve Next')} />
                <DemoButton label="Solve ALL" icon="💯" color="green"
                  onClick={() => demoAction('solve-all', { teamId: selectedDemoTeam }, 'Solve ALL')} />
                <DemoButton label="Reset Team" icon="🔄" color="red"
                  onClick={() => demoAction('reset-team', { teamId: selectedDemoTeam }, 'Reset Team')} />
              </div>
            </div>

            {/* Hint controls */}
            <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <h4 className="text-xs font-black tracking-widest text-purple-400 uppercase mb-4">🗺 HINT PROGRESSION</h4>
              <div className="flex flex-wrap gap-3">
                <DemoButton label="Unlock Stage 1" icon="🔓" color="purple"
                  onClick={() => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 1 }, 'Unlock Stage 1')} />
                <DemoButton label="Unlock Stage 2" icon="🔓" color="purple"
                  onClick={() => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 2 }, 'Unlock Stage 2')} />
                <DemoButton label="Unlock Final Hint" icon="⚡" color="purple"
                  onClick={() => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 3 }, 'Unlock Final Hint')} />
                <DemoButton label="Reset Hints" icon="🔒" color="red"
                  onClick={() => demoAction('reset-hints', { teamId: selectedDemoTeam }, 'Reset Hints')} />
              </div>
            </div>

            {/* Verdict triggers */}
            <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <h4 className="text-xs font-black tracking-widest text-sky-400 uppercase mb-4">⚖️ VERDICT SIMULATOR</h4>
              <div className="flex flex-wrap gap-3">
                <DemoButton label="Trigger AC" icon="✅" color="green"
                  onClick={() => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'AC' }, 'Trigger AC')} />
                <DemoButton label="Trigger WA" icon="❌" color="amber"
                  onClick={() => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'WA' }, 'Trigger WA')} />
                <DemoButton label="Trigger CE" icon="🔧" color="amber"
                  onClick={() => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'CE' }, 'Trigger CE')} />
                <DemoButton label="Trigger RE" icon="💥" color="red"
                  onClick={() => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'RE' }, 'Trigger RE')} />
              </div>
            </div>

            {/* Orchestration */}
            <div className="bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <h4 className="text-xs font-black tracking-widest text-amber-400 uppercase mb-4">🎭 DEMO ORCHESTRATION</h4>
              <div className="flex flex-wrap gap-3">
                <DemoButton label="Populate Leaderboard" icon="🏆" color="blue"
                  onClick={() => demoAction('populate-leaderboard', {}, 'Populate Leaderboard')} />
                <DemoButton label="Generate Activity" icon="📡" color="blue"
                  onClick={() => demoAction('generate-activity', {}, 'Generate Activity')} />
                <DemoButton label="Simulate Violation" icon="⚠️" color="red"
                  onClick={() => demoAction('simulate-violation', { teamId: selectedDemoTeam, type: 'TAB_SWITCH' }, 'Simulate Violation')} />
                <DemoButton label="Trigger Powerup" icon="🕷" color="amber"
                  onClick={() => demoAction('trigger-powerup', { teamId: selectedDemoTeam, type: 'SPIDER_SENSE' }, 'Trigger Powerup')} />
                <DemoButton label="Reset Demo Contest" icon="🚨" color="red"
                  onClick={() => demoAction('reset-contest', {}, 'Reset Demo Contest')} />
              </div>
            </div>

            {/* Warning */}
            <div className="border-2 border-dashed border-red-800 p-4 text-xs font-mono text-red-700 bg-red-950/10">
              ⚠ DEMO MODE — All actions write to the real database and trigger real Socket.IO events.
              Set DEMO_MODE=false and restart backend before any real contest.
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
