import { button, el, setAttr, setHidden, setText } from './dom'
import type { UiPanel, UiSnapshot } from './types'

export interface MultiplayerHost {
	onToggleMultiplayer?(): void
	onPlaySound?(name: string): void
}

/**
 * Opt-in multiplayer switch. Single player is the default, so the pause screen
 * is where a session against apps/server is started and stopped.
 */
export function createMultiplayerPanel(doc: Document, host: MultiplayerHost): UiPanel {
	const status = el(doc, 'span', { class: 'vc-mp-status', 'data-testid': 'multiplayer-status' })
	const toggle = button(doc, 'multiplayer-toggle', 'Connect to server', () => {
		host.onPlaySound?.('ui.click')
		host.onToggleMultiplayer?.()
	})
	toggle.classList.add('is-inline')
	const element = el(doc, 'div', { class: 'vc-mp', 'data-testid': 'multiplayer-panel' }, [
		status,
		toggle,
	])

	return {
		element,
		update(snapshot: UiSnapshot): void {
			setHidden(element, snapshot.screen !== 'pause')
			const net = snapshot.multiplayer
			setText(
				status,
				net.enabled ? `Multiplayer ${net.state} - ${net.players} players` : 'Single player',
			)
			setText(toggle, net.enabled ? 'Disconnect' : 'Connect to server')
			setAttr(element, 'data-net-state', net.enabled ? net.state : 'off')
			setAttr(element, 'data-players', String(net.players))
		},
	}
}
