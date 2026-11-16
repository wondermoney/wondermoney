import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
} from "react"

/** How long the pointer rests on a menu before it opens, so crossing the header opens nothing. */
export const HOVER_OPEN_DELAY_MS = 120
/** How long a menu stays open after the pointer leaves it, so a brief overshoot doesn't close it. */
export const HOVER_CLOSE_DELAY_MS = 150

type PendingFocus = "first" | "last"

function focusIsIn(element: HTMLElement | undefined): boolean {
	return !!element && typeof document !== "undefined" && element.contains(document.activeElement)
}

function panelLinks(panel: HTMLElement | undefined): HTMLAnchorElement[] {
	return panel ? Array.from(panel.querySelectorAll<HTMLAnchorElement>("a[href]")) : []
}

/**
 * The header's desktop dropdowns, as disclosure buttons that each show a panel of links: one
 * open at a time.
 *
 * - A mouse opens a menu by resting on it for `HOVER_OPEN_DELAY_MS` and closes it by leaving it
 *   for `HOVER_CLOSE_DELAY_MS`, unless focus is inside its panel. The root wraps the trigger and
 *   the panel, and the panel's top padding meets the trigger's area, so the pointer never leaves
 *   the root on its way into the panel. With one menu open, resting on another switches straight away, and focus inside the
 *   old panel moves to the new trigger instead of falling to the page.
 * - Touch and pen ignore hover: a tap toggles the menu. The pointer type comes from the pointer
 *   events, never the user agent.
 * - A click toggles, except that a click on a menu the mouse has just opened keeps it open.
 * - Enter and Space toggle (the trigger is a button), ArrowDown and ArrowUp open it on its first
 *   or last link, and inside the panel the arrows, Home and End move between links. Escape
 *   closes it and returns focus to the trigger; focus or a click leaving the root closes it.
 *
 * Panels stay in the document while closed, `hidden`, so the server-rendered page carries every
 * link and opening one shifts no layout.
 */
export function useNavMenus<Id extends string>(idPrefix = "nav-menu") {
	const [openId, setOpenId] = useState<Id | null>(null)
	const openRef = useRef<Id | null>(null)
	const openedByHover = useRef(false)
	const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const lastPointerType = useRef<string>("")
	const pendingFocus = useRef<PendingFocus | null>(null)
	const roots = useRef(new Map<Id, HTMLElement>())
	const triggers = useRef(new Map<Id, HTMLButtonElement>())
	const panels = useRef(new Map<Id, HTMLElement>())

	const clearTimers = useCallback(() => {
		clearTimeout(openTimer.current)
		clearTimeout(closeTimer.current)
	}, [])

	const show = useCallback((id: Id | null, byHover = false) => {
		openRef.current = id
		openedByHover.current = id !== null && byHover
		setOpenId(id)
	}, [])

	const close = useCallback(() => {
		clearTimers()
		show(null)
	}, [clearTimers, show])

	useLayoutEffect(() => {
		const target = pendingFocus.current
		if (!openId || !target) return
		pendingFocus.current = null
		const links = panelLinks(panels.current.get(openId))
		;(target === "first" ? links[0] : links[links.length - 1])?.focus()
	}, [openId])

	useEffect(() => {
		function onPointerDown(event: globalThis.PointerEvent) {
			const id = openRef.current
			if (!id) return
			const root = roots.current.get(id)
			if (root && !root.contains(event.target as Node)) close()
		}
		function onKeyDown(event: globalThis.KeyboardEvent) {
			// A menu the mouse opened while focus is elsewhere still closes on Escape.
			if (event.key === "Escape" && openRef.current) close()
		}
		document.addEventListener("pointerdown", onPointerDown)
		document.addEventListener("keydown", onKeyDown)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown)
			document.removeEventListener("keydown", onKeyDown)
			clearTimers()
		}
	}, [clearTimers, close])

	const panelId = (id: Id) => `${idPrefix}-${id}`

	function rootProps(id: Id) {
		return {
			ref: (element: HTMLElement | null) => {
				if (element) roots.current.set(id, element)
				else roots.current.delete(id)
			},
			onPointerEnter: (event: PointerEvent) => {
				if (event.pointerType !== "mouse") return
				clearTimeout(closeTimer.current)
				if (openRef.current === id) return
				clearTimeout(openTimer.current)
				const current = openRef.current
				if (current !== null) {
					// Hiding a panel that holds focus would drop it to the body: hand it to this trigger.
					if (focusIsIn(panels.current.get(current))) triggers.current.get(id)?.focus()
					show(id, true)
					return
				}
				openTimer.current = setTimeout(() => show(id, true), HOVER_OPEN_DELAY_MS)
			},
			onPointerLeave: (event: PointerEvent) => {
				if (event.pointerType !== "mouse") return
				clearTimeout(openTimer.current)
				if (openRef.current !== id) return
				closeTimer.current = setTimeout(() => {
					// A keyboard user reading the panel keeps it while the mouse wanders off.
					if (openRef.current === id && !focusIsIn(panels.current.get(id))) show(null)
				}, HOVER_CLOSE_DELAY_MS)
			},
			onBlur: (event: FocusEvent<HTMLElement>) => {
				const next = event.relatedTarget as Node | null
				// No next target means a click on something unfocusable; the pointerdown check handles that.
				if (next && openRef.current === id && !event.currentTarget.contains(next)) close()
			},
			onKeyDown: (event: KeyboardEvent) => {
				if (event.key !== "Escape" || openRef.current !== id) return
				event.preventDefault()
				event.stopPropagation()
				close()
				triggers.current.get(id)?.focus()
			},
		}
	}

	function triggerProps(id: Id) {
		return {
			ref: (element: HTMLButtonElement | null) => {
				if (element) triggers.current.set(id, element)
				else triggers.current.delete(id)
			},
			type: "button" as const,
			"aria-expanded": openId === id,
			"aria-controls": panelId(id),
			onPointerDown: (event: PointerEvent) => {
				lastPointerType.current = event.pointerType
			},
			onClick: (event: MouseEvent) => {
				// `detail` is 0 for a click made with Enter or Space.
				const byMouse = event.detail > 0 && lastPointerType.current === "mouse"
				clearTimers()
				if (openRef.current === id) {
					if (byMouse && openedByHover.current) openedByHover.current = false
					else show(null)
					return
				}
				show(id)
			},
			onKeyDown: (event: KeyboardEvent) => {
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
				event.preventDefault()
				clearTimers()
				const target: PendingFocus = event.key === "ArrowDown" ? "first" : "last"
				if (openRef.current === id) {
					const links = panelLinks(panels.current.get(id))
					;(target === "first" ? links[0] : links[links.length - 1])?.focus()
					return
				}
				pendingFocus.current = target
				show(id)
			},
		}
	}

	function panelProps(id: Id) {
		return {
			ref: (element: HTMLElement | null) => {
				if (element) panels.current.set(id, element)
				else panels.current.delete(id)
			},
			id: panelId(id),
			hidden: openId !== id,
			onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
				const links = panelLinks(event.currentTarget)
				if (links.length === 0) return
				const current = links.indexOf(document.activeElement as HTMLAnchorElement)
				let next: number
				switch (event.key) {
					case "ArrowDown":
						next = current < 0 ? 0 : (current + 1) % links.length
						break
					case "ArrowUp":
						next = current < 0 ? links.length - 1 : (current - 1 + links.length) % links.length
						break
					case "Home":
						next = 0
						break
					case "End":
						next = links.length - 1
						break
					default:
						return
				}
				event.preventDefault()
				links[next].focus()
			},
		}
	}

	return { openId, close, rootProps, triggerProps, panelProps }
}
