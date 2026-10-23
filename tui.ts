// Заголовок терминала OpenCode: снимает служебный префикс «OC | » и ставит «◉ »,
// когда сессия ждёт владельца — висит разрешение/форма или последняя реплика
// ассистента кончается строкой «needs input:».
//
// Штатный TUI ставит заголовок сам (packages/tui/src/app.tsx), поэтому плагин
// подменяет renderer.setTerminalTitle: так он видит и название сессии, и смену
// маршрута, и не спорит с хостом за один и тот же заголовок.

const PREFIX = "OC | "
const NEEDS_INPUT = "needs input:"
const MARK = "◉ "

function stripPrefix(title: string): string {
  return title.startsWith(PREFIX) ? title.slice(PREFIX.length) : title
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
    const renderer = context.renderer
    const setTitle = renderer.setTerminalTitle.bind(renderer)
    const waiting = new Map<string, boolean>()
    const generations = new Map<string, number>()
    let base = ""
    let active: string | undefined

    const currentSession = (): string | undefined => {
      const route = context.ui.router.current()
      return route.type === "session" ? context.data.session.root(route.sessionID) : undefined
    }

    const paint = (): void => {
      // Пока TUI приостановлен (Ctrl+Z, внешний редактор), заголовок не трогаем:
      // штатный помощник хоста в этом состоянии тоже молчит.
      if (!base || renderer.isDestroyed || renderer.controlState === "explicit_suspended") return
      const mark = active !== undefined && waiting.get(active) === true ? MARK : ""
      setTitle(mark + base)
    }

    renderer.setTerminalTitle = (title: string): void => {
      if (!title) {
        base = ""
        setTitle("")
        return
      }
      base = stripPrefix(title)
      active = currentSession()
      paint()
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

      const messages: any[] = context.data.session.message.list(sessionID)
      const last = [...messages].reverse().find((message) => message?.type === "assistant")
      const text = last
        ? (last.content ?? [])
            .filter((part: any) => part?.type === "text")
            .map((part: any) => part.text)
            .join("\n")
        : ""
      const running = context.data.session.status(sessionID) === "running"

      waiting.set(sessionID, blocked || (!running && waitsForInput(text)))
      if (active === sessionID) paint()
    }

    const watched = new Set([
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
      "session.status",
      "permission.asked",
      "permission.replied",
      "form.created",
      "form.replied",
      "form.cancelled",
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
      stop()
      renderer.setTerminalTitle = setTitle
    }
  },
}
