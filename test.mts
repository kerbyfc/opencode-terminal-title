import assert from "node:assert/strict"
import test from "node:test"
import plugin, { waitsForInput } from "./tui.ts"

test("waitsForInput смотрит на последнюю непустую строку", () => {
  assert.equal(waitsForInput("готово\nneeds input: [Вопрос](obsidian://x)"), true)
  assert.equal(waitsForInput("готово\nпотом ещё текст"), false)
  assert.equal(waitsForInput("**needs input:** ссылка"), true)
  assert.equal(waitsForInput(""), false)
})

test("заголовок: префикс, needs input, работа, разрешение и главная", async () => {
  const titles: string[] = []
  let listener: ((event: any) => void) | undefined
  let sessionID = "ses_root"
  let running = false
  let permissions: any[] = []
  let messages: any[] = []

  const context = {
    renderer: {
      isDestroyed: false,
      setTerminalTitle(title: string) {
        titles.push(title)
      },
    },
    ui: {
      router: {
        current() {
          return sessionID === "home" ? { type: "home" } : { type: "session", sessionID }
        },
      },
    },
    data: {
      listen(fn: (event: any) => void) {
        listener = fn
        return () => {}
      },
      session: {
        root(id: string) {
          return id
        },
        family(id: string) {
          return [id]
        },
        status() {
          return running ? "running" : "idle"
        },
        message: {
          list() {
            return messages
          },
          sync() {
            return Promise.resolve()
          },
        },
        permission: {
          list() {
            return permissions
          },
        },
        form: {
          list() {
            return []
          },
        },
      },
    },
  }

  const cleanup = plugin.setup(context as any)
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

  // Штатный TUI ставит заголовок с префиксом — плагин его снимает.
  context.renderer.setTerminalTitle("OC | Демо")
  assert.equal(titles.at(-1), "Демо")

  // Последняя реплика кончается статусом — появляется маркер ожидания.
  messages = [
    {
      type: "assistant",
      content: [{ type: "text", text: "Готово.\nneeds input: [Вопрос](obsidian://adv-uri?x=1)" }],
    },
  ]
  listener?.({ details: { type: "session.execution.succeeded" } })
  await tick()
  assert.equal(titles.at(-1), "◉ Демо")

  // Во время работы маркера нет.
  running = true
  listener?.({ details: { type: "session.execution.started" } })
  await tick()
  assert.equal(titles.at(-1), "Демо")

  // Разрешение включает маркер, ответ — снимает.
  running = false
  messages = [{ type: "assistant", content: [{ type: "text", text: "Продолжаю." }] }]
  permissions = [{ id: "perm_1" }]
  listener?.({ details: { type: "permission.asked" } })
  await tick()
  assert.equal(titles.at(-1), "◉ Демо")

  permissions = []
  listener?.({ details: { type: "permission.replied" } })
  await tick()
  assert.equal(titles.at(-1), "Демо")

  // На главной маркер не остаётся.
  sessionID = "home"
  context.renderer.setTerminalTitle("OpenCode")
  assert.equal(titles.at(-1), "OpenCode")

  cleanup?.()
})
