import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import lobbyBg from '../../Assets/Page 3.png';
import GlitchText from './GlitchText';
import TopBar from './TopBar';
import { socket } from '../lib/socket';
export default function Lobby({ onProceed, teamName, onTeamNameChange, lobbyTimeLeftMs = 0, contestStatus }) {
    const [timeLeft, setTimeLeft] = useState(0);
    const [isStarting, setIsStarting] = useState(false);
    // Synchronize local timeLeft state when lobbyTimeLeftMs prop changes from parent
    useEffect(() => {
        if (contestStatus === 'NOT_STARTED') {
            setTimeLeft(900); // 15:00
        }
        else {
            setTimeLeft(Math.max(0, Math.ceil(lobbyTimeLeftMs / 1000)));
        }
    }, [lobbyTimeLeftMs, contestStatus]);
    // Server-synced countdown timer
    useEffect(() => {
        if (timeLeft <= 0 || contestStatus === 'NOT_STARTED')
            return;
        const timer = setInterval(() => {
            setTimeLeft(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [timeLeft, contestStatus]);
    // HIGH-8: Lobby exits ONLY when admin fires 'contest:started' from the backend.
    // The previous fake team counter that auto-proceeded after ~2 min has been removed.
    useEffect(() => {
        const handleContestStarted = () => {
            setIsStarting(true);
            const t = setTimeout(() => onProceed(), 2000);
            return () => clearTimeout(t);
        };
        socket.on('contest:started', handleContestStarted);
        socket.on('contest:resumed', handleContestStarted);
        return () => {
            socket.off('contest:started', handleContestStarted);
            socket.off('contest:resumed', handleContestStarted);
        };
    }, [onProceed]);
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };
    return (_jsxs("div", { className: "h-screen w-screen bg-[#05050d] flex flex-col overflow-hidden select-none relative", style: { backgroundImage: `url(${lobbyBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }, children: [_jsx(TopBar, { isLobby: true, teamName: teamName, onTeamNameChange: onTeamNameChange }), _jsx("div", { className: "absolute inset-0 comic-halftone opacity-20 pointer-events-none z-0" }), _jsxs("div", { className: "absolute top-[56%] left-[50.8%] transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center text-center z-10 w-[240px]", children: [_jsx("div", { className: "absolute w-[200px] h-[200px] bg-red-600/10 rounded-full blur-2xl pointer-events-none -z-10 animate-pulse" }), isStarting ? (_jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-comic text-yellow-400 text-3xl tracking-widest uppercase animate-bounce", children: "PREPARE!" }), _jsx("span", { className: "font-sans text-xs text-zinc-300 tracking-wider uppercase font-bold", children: "ADMIN STARTING MISSION..." })] })) : (_jsx(GlitchText, { className: "font-digital text-red-500 text-5xl font-black tracking-widest drop-shadow-[0_0_12px_rgba(239,68,68,0.6)]", children: formatTime(timeLeft) }))] }), _jsxs("div", { className: "absolute bottom-[10%] left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 z-10", children: [_jsx("div", { className: "font-comic text-2xl sm:text-3xl text-white tracking-widest uppercase select-none italic text-center drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]", children: isStarting
                            ? _jsx("span", { className: "text-emerald-400 animate-pulse", children: "ENTERING THE SPIDER-VERSE..." })
                            : _jsxs("span", { children: ["AWAITING ADMIN START SIGNAL", _jsx("span", { className: "animate-pulse", children: "..." })] }) }), _jsxs("div", { className: "flex items-center gap-2 mt-1", children: [_jsx("span", { className: "w-2 h-2 rounded-full bg-red-500 animate-ping" }), _jsx("span", { className: "font-mono text-xs text-zinc-400 uppercase tracking-widest", children: isStarting ? 'Synchronizing multiverse...' : 'Standing by' })] })] })] }));
}
//# sourceMappingURL=Lobby.js.map