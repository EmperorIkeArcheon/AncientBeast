/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { UndoManager } from '../undo';

/** Minimal stand-in for the parts of Game that UndoManager reads. */
function makeGame(overrides: Record<string, unknown> = {}) {
	const game: any = {
		multiplayer: false,
		isReplayInProgress: false,
		gameState: 'playing',
		turn: 3,
		turnThrottle: false,
		freezedInput: false,
		animationQueue: [],
		_deferredQueryMovePending: 0,
		trapId: 0,
		effectId: 0,
		dropId: 0,
		creatures: [
			{ id: 0, dead: false },
			{ id: 1, dead: false },
		],
		traps: [],
		drops: [],
		effects: [],
		queue: { queue: [{}, {}], nextQueue: [] },
		activeCreature: { id: 1, player: { controller: 'human' } },
		gamelog: { actions: [] as unknown[] },
		serializeSnapshot: jest.fn(() => ({ marker: 'snapshot' })),
		restoreFromUndo: jest.fn(),
		...overrides,
	};
	game.undo = new UndoManager(game);
	return game;
}

/** Simulates "the player moved": capture, log the action, board goes idle. */
function doAction(game: any) {
	game.undo.capture();
	game.gamelog.actions.push({ action: 'move' });
}

describe('UndoManager', () => {
	let game: any;
	beforeEach(() => {
		game = makeGame();
	});

	test('nothing to undo before any action', () => {
		expect(game.undo.canUndo()).toBe(false);
		expect(game.undo.undo()).toBe(false);
	});

	test('the last action can be undone and the log is rewound', () => {
		game.gamelog.actions.push({ action: 'skip' });
		doAction(game);
		expect(game.undo.canUndo()).toBe(true);

		expect(game.undo.undo()).toBe(true);
		expect(game.restoreFromUndo).toHaveBeenCalledWith({ marker: 'snapshot' }, 1);
	});

	test('only usable once per round, and again after a new round starts', () => {
		doAction(game);
		expect(game.undo.undo()).toBe(true);

		doAction(game);
		expect(game.undo.canUndo()).toBe(false);

		game.turn = 4;
		game.undo.onNewRound();
		doAction(game);
		expect(game.undo.canUndo()).toBe(true);
	});

	test('a newer action replaces the older one (only the very last is undoable)', () => {
		doAction(game);
		doAction(game);
		game.undo.undo();
		expect(game.restoreFromUndo).toHaveBeenCalledWith({ marker: 'snapshot' }, 1);
	});

	test('unavailable while the action is still animating or input is locked', () => {
		doAction(game);
		game.animationQueue.push('anim');
		expect(game.undo.canUndo()).toBe(false);
		game.animationQueue.length = 0;
		game.freezedInput = true;
		expect(game.undo.canUndo()).toBe(false);
		game.freezedInput = false;
		expect(game.undo.canUndo()).toBe(true);
	});

	test('unavailable when the action killed or created something', () => {
		doAction(game);
		game.creatures[0].dead = true;
		expect(game.undo.canUndo()).toBe(false);

		doAction(game);
		game.effects.push({});
		expect(game.undo.canUndo()).toBe(false);
	});

	test('unavailable after the turn is handed over', () => {
		doAction(game);
		game.undo.clear();
		expect(game.undo.canUndo()).toBe(false);

		doAction(game);
		game.activeCreature = { id: 0, player: { controller: 'human' } };
		expect(game.undo.canUndo()).toBe(false);
	});

	test('disabled in multiplayer, replays and for bot turns', () => {
		for (const patch of [
			{ multiplayer: true },
			{ isReplayInProgress: true },
			{ activeCreature: { id: 1, player: { controller: 'bot' } } },
		]) {
			const g = makeGame(patch);
			doAction(g);
			expect(g.undo.canUndo()).toBe(false);
		}
	});

	test('an unsnapshottable board just means Undo is unavailable', () => {
		game.serializeSnapshot.mockImplementation(() => {
			throw new Error('pending animation');
		});
		doAction(game);
		expect(game.undo.canUndo()).toBe(false);
	});
});
