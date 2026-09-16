import { button, el, setHidden } from './dom'
import type { UiPanel, UiScreen, UiSnapshot } from './types'

export interface PauseHost {
	onResume?(): void
	onOpenSettings?(): void
	onSave?(): void
	onQuit?(): void
	onPlaySound?(name: string): void
}

export function createPauseScreen(doc: Document, host: PauseHost): UiPanel {
	const click = (run: () => void) => (): void => {
		host.onPlaySound?.('ui.click')
		run()
	}

	const element = el(doc, 'div', { class: 'vc-screen vc-pause', 'data-testid': 'pause-screen' }, [
		el(doc, 'h2', {}, ['Game paused']),
		button(
			doc,
			'pause-resume',
			'Back to game',
			click(() => host.onResume?.()),
		),
		button(
			doc,
			'pause-settings',
			'Settings',
			click(() => host.onOpenSettings?.()),
		),
		button(
			doc,
			'pause-save',
			'Save world',
			click(() => host.onSave?.()),
		),
		button(
			doc,
			'pause-quit',
			'Save and quit',
			click(() => host.onQuit?.()),
		),
	])

	const screen: UiScreen = 'pause'
	return {
		element,
		update(snapshot: UiSnapshot): void {
			setHidden(element, snapshot.screen !== screen)
		},
	}
}
