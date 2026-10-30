import type { Config, Preset } from './types';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
/** The night is a fixed length so nobody's timing gives anything away. */
export const NIGHT_MS = 90_000;

export function presetFor(players: number): Preset {
  if (players < MIN_PLAYERS || players > MAX_PLAYERS) {
    throw new RangeError(`unsupported player count: ${players}`);
  }
  if (players <= 5) return { traitors: 1, murders: false, recruitment: false, endgameAt: 3 };
  if (players <= 7) return { traitors: 1, murders: true, recruitment: false, endgameAt: 3 };
  if (players === 8) return { traitors: 2, murders: true, recruitment: true, endgameAt: 3 };
  if (players <= 12) return { traitors: 2, murders: true, recruitment: true, endgameAt: 4 };
  return { traitors: 3, murders: true, recruitment: true, endgameAt: 5 };
}

export const DEFAULT_CONFIG: Config = {
  timers: {
    roleRevealMs: 30_000,
    missionMs: 120_000,
    discussionMs: 300_000,
    votingMs: 45_000,
    voteRevealStepMs: 4_000,
    speechMs: 30_000,
    endgameVoteMs: 45_000,
    recruitMs: 30_000,
    breakfastStepMs: 2_500,
    physicalMs: 180_000,
  },
  revealRoles: 'always',
  questionsPerMission: 8,
  potPerCorrect: 100,
  physicalPot: 400,
};
