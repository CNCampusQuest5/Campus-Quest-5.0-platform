/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import lobbyBg from '../../Assets/Page 3.png';
import GlitchText from './GlitchText';
import TopBar from './TopBar';
import { socket } from '../lib/socket';

interface LobbyProps {
  onProceed: () => void;
  teamName: string;
  onTeamNameChange: (name: string) => void;
  lobbyTimeLeftMs?: number;
  contestStatus?: string;
}

export default function Lobby({ onProceed, teamName, onTeamNameChange, lobbyTimeLeftMs = 0, contestStatus }: LobbyProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  // Synchronize local timeLeft state when lobbyTimeLeftMs prop changes from parent
  useEffect(() => {
    if (contestStatus === 'NOT_STARTED') {
      setTimeLeft(900); // 15:00
    } else {
      setTimeLeft(Math.max(0, Math.ceil(lobbyTimeLeftMs / 1000)));
    }
  }, [lobbyTimeLeftMs, contestStatus]);

  // Server-synced countdown timer
  useEffect(() => {
    if (timeLeft <= 0 || contestStatus === 'NOT_STARTED') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, contestStatus]);

  // If contest is ALREADY running when Lobby mounts or syncs, immediately proceed!
  useEffect(() => {
    if (contestStatus === 'RUNNING') {
      setIsStarting(true);
      const t = setTimeout(() => onProceed(), 500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [contestStatus, onProceed]);

  // HIGH-8: Lobby exits when admin fires 'contest:started' or 'contest:resumed' from the backend.
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div 
      className="h-screen w-screen bg-[#05050d] flex flex-col overflow-hidden select-none relative"
      style={{ backgroundImage: `url(${lobbyBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
    >
      <TopBar isLobby={true} teamName={teamName} onTeamNameChange={onTeamNameChange} />
      {/* Halftone texture overlay for comic printed feel */}
      <div className="absolute inset-0 comic-halftone opacity-20 pointer-events-none z-0" />

      {/* Center Circle Content (precisely aligned inside the red spider-web circle) */}
      <div className="absolute top-[56%] left-[50.8%] transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center text-center z-10 w-[240px]">
        {/* Glow effect matching the orb theme */}
        <div className="absolute w-[200px] h-[200px] bg-red-600/10 rounded-full blur-2xl pointer-events-none -z-10 animate-pulse" />

        {isStarting ? (
          <div className="flex flex-col items-center gap-1">
            <span className="font-comic text-yellow-400 text-3xl tracking-widest uppercase animate-bounce">
              PREPARE!
            </span>
            <span className="font-sans text-xs text-zinc-300 tracking-wider uppercase font-bold">
              ADMIN STARTING MISSION...
            </span>
          </div>
        ) : (
          <GlitchText className="font-digital text-red-500 text-5xl font-black tracking-widest drop-shadow-[0_0_12px_rgba(239,68,68,0.6)]">
            {formatTime(timeLeft)}
          </GlitchText>
        )}
      </div>

      {/* Bottom Area: Waiting for admin */}
      <div className="absolute bottom-[10%] left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 z-10">
        <div className="font-comic text-2xl sm:text-3xl text-white tracking-widest uppercase select-none italic text-center drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
          {isStarting
            ? <span className="text-emerald-400 animate-pulse">ENTERING THE SPIDER-VERSE...</span>
            : <span>AWAITING ADMIN START SIGNAL<span className="animate-pulse">...</span></span>
          }
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          <span className="font-mono text-xs text-zinc-400 uppercase tracking-widest">
            {isStarting ? 'Synchronizing multiverse...' : 'Standing by'}
          </span>
        </div>
      </div>
    </div>
  );
}

