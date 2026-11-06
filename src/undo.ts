/* eslint-disable @typescript-eslint/no-explicit-any */
import type Game from './game';

/**
 * "Undo Move" (issue #2704).
 *
 * Right before the active creature performs an action (a move or an ability),
 * `capture()` stores a match snapshot and the current gamelog length. While the
 * action is the very last thing that happened, `canUndo()` is true and the
 * Undo button replaces the Delay button; `undo()` then turns the board back to
 * the captured state.
 *
 * Rules (from the issue):
 *  - Only the very last action can be undone.
 *  - Usable once per match round.
 *  - Mutually exclusive with "Delay Unit" - the UI shows one or the other.
 *
 * Scope: an action is only undoable when it left the *set* of board entities
 * alone (no deaths, summons, traps, drops or new/removed effects). Everything
 * else those actions can touch - positions, health, energy, endurance, ability
 * usage, statuses, plasma - is covered by the snapshot. Rolling back sprites of
 * entities that were created or destroyed needs a real state manager, so those
 * actions simply do not offer Undo; Delay stays visible instead.
 */

type UndoRecord = {
	snapshot: any;
	/** Fingerprint of the entity sets when the action started. */
	fingerprint: string;
	/** `gamelog.actions.length` before the action was logged. */
	gamelogLength: number;
	creatureId: number;
	round: number;
};

/** Cheap summary of everything an undo cannot recreate (see "Scope" above). */
function entityFingerprint(game: Game): string {
	const creatures = (game.creatures || []).filter(Boolean);
	return [
		creatures.length,
		creatures.filter((c) => !c.dead).length,
		game.traps.length,
		game.drops.length,
		game.effects.length,
		game.trapId,
		game.effectId,
		game.dropId,
		game.queue.queue.length,
		game.queue.nextQueue.length,
	].join('|');
}

export class UndoManager {
	private record: UndoRecord | null = null;
	/** Round in which Undo was last used, or -1 if it has not been used yet. */
	private usedInRound = -1;

	constructor(private readonly game: Game) {}

	/** Whether this kind of match supports undoing at all. */
	private get enabled(): boolean {
		const game = this.game;
		return (
			!game.multiplayer &&
			!game.isReplayInProgress &&
			game.gameState === 'playing' &&
			game.activeCreature?.player?.controller === 'human'
		);
	}

	/**
	 * Remember the board as it is right now. Call just before an action is
	 * logged and started. A newer capture replaces the older one, which is what
	 * keeps Undo limited to the very last action.
	 */
	capture(): void {
		this.record = null;
		const game = this.game;
		const creature = game.activeCreature;
		if (!this.enabled || !creature || this.usedInRound === game.turn) {
			return;
		}
		try {
			this.record = {
				snapshot: game.serializeSnapshot(),
				fingerprint: entityFingerprint(game),
				gamelogLength: game.gamelog.actions.length,
				creatureId: creature.id,
				round: game.turn,
			};
		} catch (error) {
			// Pending effects, events or animations make a faithful snapshot
			// impossible (SnapshotCompatibilityError). Undo is just unavailable.
			this.record = null;
		}
	}

	/** Forget the captured action, e.g. when the turn is handed over. */
	clear(): void {
		this.record = null;
	}

	/** A new round gives the player their Undo back. */
	onNewRound(): void {
		this.record = null;
		this.usedInRound = -1;
	}

	/** True when Undo can be used right now. */
	canUndo(): boolean {
		const game = this.game;
		const record = this.record;
		if (!record || !this.enabled) {
			return false;
		}
		return (
			this.usedInRound !== game.turn &&
			record.round === game.turn &&
			record.creatureId === game.activeCreature?.id &&
			// The action has to be fully resolved: nothing animating, no input lock
			game.animationQueue.length === 0 &&
			!game._deferredQueryMovePending &&
			!game.turnThrottle &&
			!game.freezedInput &&
			// Something has to have happened since the capture
			game.gamelog.actions.length > record.gamelogLength &&
			// ...and it must not have created or destroyed anything
			entityFingerprint(game) === record.fingerprint
		);
	}

	/** Turn back time to just before the last action. Returns true on success. */
	undo(): boolean {
		if (!this.canUndo() || !this.record) {
			return false;
		}
		const { snapshot, gamelogLength } = this.record;
		this.record = null;
		this.usedInRound = this.game.turn;
		this.game.restoreFromUndo(snapshot, gamelogLength);
		return true;
	}
}
