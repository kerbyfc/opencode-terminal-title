// Заголовок терминала OpenCode: снимает служебный префикс (по умолчанию «OC | »),
// показывает сменой символов работу (агент, сабагенты, shell) и ставит маркер
// (по умолчанию «◉ »), когда сессия ждёт владельца — висит разрешение/форма или
// последняя реплика ассистента кончается «needs input:».
//
// Штатный TUI ставит заголовок сам (packages/tui/src/app.tsx), поэтому плагин
// подменяет renderer.setTerminalTitle: так он видит и название сессии, и смену
// маршрута, и не спорит с хостом за один и тот же заголовок.

const DEFAULT_STRIP = /^OC \| /
const DEFAULT_MARK = "◉"
const DEFAULT_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const DEFAULT_SPINNER_INTERVAL = 100
const NEEDS_INPUT = "needs input:"

type Mode = "idle" | "waiting" | "busy"

// Настройки приходят из cli.json: plugins[].options. Кривое значение — ошибка
// загрузки плагина, а не тихая подмена: иначе настройка молча не работает.
function stripRule(value: unknown): RegExp {
  if (value === undefined) return DEFAULT_STRIP
  if (typeof value !== "string") throw new Error('opencode-terminal-title: "strip" must be a regular expression string')
  try {
    return new RegExp(value)
  } catch (error) {
    throw new Error(`opencode-terminal-title: invalid "strip" regular expression: ${String(error)}`)
  }
}

// Маркер и кадры отделяются от заголовка одним пробелом; пустая строка выключает знак.
function markText(value: string): string {
  const text = value.trimEnd()
  return text === "" ? "" : `${text} `
}

function markRule(value: unknown): string {
  if (value === undefined) return markText(DEFAULT_MARK)
  if (typeof value !== "string") throw new Error('opencode-terminal-title: "marker" must be a string')
  return markText(value)
}

function spinnerRule(value: unknown): string[] {
  if (value === undefined) return DEFAULT_SPINNER.map(markText)
  if (value === false) return []
  if (!Array.isArray(value) || !value.every((frame) => typeof frame === "string"))
    throw new Error('opencode-terminal-title: "spinner" must be an array of strings or false')
  return value.map((frame) => markText(frame))
}

function intervalRule(value: unknown): number {
  if (value === undefined) return DEFAULT_SPINNER_INTERVAL
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error('opencode-terminal-title: "spinnerInterval" must be a positive number')
  return value
}

// Статус — последняя непустая строка ответа. Проверяем её начало, а не вхождение
// подстроки: «needs input:» внутри объяснения не должно включать знак.
export function waitsForInput(text: string): boolean {
  const lines = text.trimEnd().split("\n")
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trimStart() ?? ""
    if (line === "") continue
    return line.replace(/^\*\*/, "").startsWith(NEEDS_INPUT)
  }
  return false
}

export default {
  id: "kerbyfc.terminal-title.tui",
  setup(context: any) {
    const strip = stripRule(context.options?.strip)
    const marker = markRule(context.options?.marker)
    const frames = spinnerRule(context.options?.spinner)
    const interval = intervalRule(context.options?.spinnerInterval)
    const renderer = context.renderer
    const setTitle = renderer.setTerminalTitle.bind(renderer)
    const modes = new Map<string, Mode>()
    const generations = new Map<string, number>()
    let base = ""
    let active: string | undefined
    let frame = 0
    let timer: ReturnType<typeof setInterval> | undefined

    const currentSession = (): string | undefined => {
      const route = context.ui.router.current()
      return route.type === "session" ? context.data.session.root(route.sessionID) : undefined
    }

    const stopTimer = (): void => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }

    const paint = (): void => {
      // Пока TUI приостановлен (Ctrl+Z, внешний редактор), заголовок не трогаем:
      // штатный помощник хоста в этом состоянии тоже молчит.
      if (!base || renderer.isDestroyed || renderer.controlState === "explicit_suspended") return
      const mode = active === undefined ? undefined : modes.get(active)
      const mark =
        mode === "waiting"
          ? marker
          : mode === "busy" && frames.length > 0
            ? frames[frame % frames.length] ?? ""
            : ""
      setTitle(mark + base)
    }

    const syncTimer = (): void => {
      const mode = active === undefined ? undefined : modes.get(active)
      if (mode !== "busy" || frames.length <= 1) {
        stopTimer()
        return
      }
      if (timer !== undefined) return
      frame = 0
      timer = setInterval(() => {
        frame = (frame + 1) % frames.length
        paint()
      }, interval)
    }

    const applyMode = (): void => {
      syncTimer()
      paint()
    }

    renderer.setTerminalTitle = (title: string): void => {
      if (!title) {
        stopTimer()
        base = ""
        setTitle("")
        return
      }
      base = title.replace(strip, "")
      active = currentSession()
      applyMode()
    }

    const refresh = async (sessionID: string): Promise<void> => {
      const generation = (generations.get(sessionID) ?? 0) + 1
      generations.set(sessionID, generation)
      try {
        await context.data.session.message.sync(sessionID)
      } catch {
        // Сервер недоступен — оставляем прежнее состояние: заголовок не должен
        // мигать из-за неудачной синхронизации.
      }
      if (generations.get(sessionID) !== generation) return

      const family: string[] = context.data.session.family(sessionID)
      const blocked = family.some((id) => {
        const permissions = context.data.session.permission.list(id) ?? []
        const forms = context.data.session.form.list(id) ?? []
        return permissions.length > 0 || forms.length > 0
      })
      const running = family.some((id) => context.data.session.status(id) === "running")
      const pending = family.some((id) =>
        (context.data.session.pending.list(id) ?? []).some((item: any) => item?.type !== "synthetic"),
      )
      const shells = context.data.shell.list(context.data.session.get(sessionID)?.location) ?? []
      const shell = shells.some((item: any) => item?.status === "running")

      const messages: any[] = context.data.session.message.list(sessionID)
      const last = [...messages].reverse().find((message) => message?.type === "assistant")
      const text = last
        ? (last.content ?? [])
            .filter((part: any) => part?.type === "text")
            .map((part: any) => part.text)
            .join("\n")
        : ""
      const waiting = blocked || (!running && !pending && !shell && waitsForInput(text))
      modes.set(sessionID, waiting ? "waiting" : running || pending || shell ? "busy" : "idle")
      if (active === sessionID) applyMode()
    }

    const watched = new Set([
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
      "session.status",
      "session.inbox.enqueued",
      "session.inbox.delivered",
      "session.inbox.cancelled",
      "session.inbox.delivery.changed",
      "permission.asked",
      "permission.replied",
      "form.created",
      "form.replied",
      "form.cancelled",
      "shell.created",
      "shell.exited",
      "shell.deleted",
      "session.viewed",
    ])

    const stop = context.data.listen(({ details }: any) => {
      if (!watched.has(details?.type)) return
      const sessionID = currentSession()
      if (sessionID) void refresh(sessionID)
    })

    const sessionID = currentSession()
    if (sessionID) void refresh(sessionID)

    return () => {
      stopTimer()
      stop()
      renderer.setTerminalTitle = setTitle
    }
  },
}
