import assert from "node:assert/strict"
import test from "node:test"
import plugin, { waitsForInput } from "./tui.ts"

function harness(options: Record<string, unknown> = {}) {
  const titles: string[] = []
  let listener: ((event: any) => void) | undefined
  const state = {
    sessionID: "ses_root",
    family: ["ses_root"],
    running: new Set<string>(),
    pending: [] as any[],
    permissions: [] as any[],
    shells: [] as any[],
    messages: [] as any[],
  }

  const context = {
    options,
    renderer: {
      isDestroyed: false,
      setTerminalTitle(title: string) {
        titles.push(title)
      },
    },
    ui: {
      router: {
        current() {
          return state.sessionID === "home" ? { type: "home" } : { type: "session", sessionID: state.sessionID }
        },
      },
    },
    data: {
      listen(fn: (event: any) => void) {
        listener = fn
        return () => {}
      },
      session: {
        get(id: string) {
          return { id, location: { directory: "/tmp" } }
        },
        root(id: string) {
          return id
        },
        family() {
          return state.family
        },
        status(id: string) {
          return state.running.has(id) ? "running" : "idle"
        },
        message: {
          list() {
            return state.messages
          },
          sync() {
            return Promise.resolve()
          },
        },
        pending: {
          list() {
            return state.pending
          },
        },
        permission: {
          list() {
            return state.permissions
          },
        },
        form: {
          list() {
            return []
          },
        },
      },
      shell: {
        list() {
          return state.shells
        },
      },
    },
  }

  const cleanup = plugin.setup(context as any)
  return {
    context,
    titles,
    state,
    emit(type: string) {
      listener?.({ details: { type } })
    },
    tick: () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
    cleanup,
  }
}

test("waitsForInput смотрит на последнюю непустую строку", () => {
  assert.equal(waitsForInput("готово\nneeds input: [Вопрос](obsidian://x)"), true)
  assert.equal(waitsForInput("готово\nпотом ещё текст"), false)
  assert.equal(waitsForInput("**needs input:** ссылка"), true)
  assert.equal(waitsForInput(""), false)
})

test("заголовок: префикс, needs input, работа, разрешение и главная", async () => {
  const h = harness()

  // Штатный TUI ставит заголовок с префиксом — плагин его снимает.
  h.context.renderer.setTerminalTitle("OC | Демо")
  assert.equal(h.titles.at(-1), "Демо")

  // Последняя реплика кончается статусом — появляется маркер ожидания.
  h.state.messages = [
    {
      type: "assistant",
      content: [{ type: "text", text: "Готово.\nneeds input: [Вопрос](obsidian://adv-uri?x=1)" }],
    },
  ]
  h.emit("session.execution.succeeded")
  await h.tick()
  assert.equal(h.titles.at(-1), "◉ Демо")

  // Во время работы идёт анимация, маркера ожидания нет.
  h.state.running.add("ses_root")
  h.emit("session.execution.started")
  await h.tick()
  assert.equal(h.titles.at(-1), "⠋ Демо")

  // Разрешение включает маркер, ответ — снимает.
  h.state.running.clear()
  h.state.messages = [{ type: "assistant", content: [{ type: "text", text: "Продолжаю." }] }]
  h.state.permissions = [{ id: "perm_1" }]
  h.emit("permission.asked")
  await h.tick()
  assert.equal(h.titles.at(-1), "◉ Демо")

  h.state.permissions = []
  h.emit("permission.replied")
  await h.tick()
  assert.equal(h.titles.at(-1), "Демо")

  // На главной маркер не остаётся.
  h.state.sessionID = "home"
  h.context.renderer.setTerminalTitle("OpenCode")
  assert.equal(h.titles.at(-1), "OpenCode")

  h.cleanup?.()
})

test("настройки: своя регулярка для префикса и свой маркер", async () => {
  const h = harness({ strip: "^PREFIX ", marker: "▲" })

  h.context.renderer.setTerminalTitle("PREFIX Demo")
  assert.equal(h.titles.at(-1), "Demo")

  h.state.messages = [{ type: "assistant", content: [{ type: "text", text: "needs input: x" }] }]
  h.emit("session.execution.succeeded")
  await h.tick()
  assert.equal(h.titles.at(-1), "▲ Demo")

  h.cleanup?.()
})

test("настройки: свой набор кадров и скорость анимации", async () => {
  const h = harness({ spinner: ["a", "b"], spinnerInterval: 5 })

  h.context.renderer.setTerminalTitle("OC | Demo")
  h.state.running.add("ses_root")
  h.emit("session.execution.started")
  await h.tick()
  assert.match(h.titles.at(-1) ?? "", /^[ab] Demo$/)

  h.state.running.clear()
  h.emit("session.execution.succeeded")
  await h.tick()
  assert.equal(h.titles.at(-1), "Demo")

  h.cleanup?.()
})

test("настройки: spinner: false выключает анимацию", async () => {
  const h = harness({ spinner: false })

  h.context.renderer.setTerminalTitle("OC | Demo")
  h.state.running.add("ses_root")
  h.emit("session.execution.started")
  await h.tick()
  assert.equal(h.titles.at(-1), "Demo")

  h.cleanup?.()
})

test("настройки: пустой маркер выключает знак", async () => {
  const h = harness({ marker: "" })

  h.context.renderer.setTerminalTitle("OC | Demo")
  assert.equal(h.titles.at(-1), "Demo")

  h.state.messages = [{ type: "assistant", content: [{ type: "text", text: "needs input: x" }] }]
  h.emit("session.execution.succeeded")
  await h.tick()
  assert.equal(h.titles.at(-1), "Demo")

  h.cleanup?.()
})

test("shell считается работой", async () => {
  const h = harness()

  h.context.renderer.setTerminalTitle("OC | Demo")
  h.state.shells = [{ status: "running" }]
  h.emit("shell.created")
  await h.tick()
  assert.equal(h.titles.at(-1), "⠋ Demo")

  h.state.shells = []
  h.emit("shell.exited")
  await h.tick()
  assert.equal(h.titles.at(-1), "Demo")

  h.cleanup?.()
})

test("сабагент считается работой", async () => {
  const h = harness()

  h.state.family = ["ses_root", "ses_child"]
  h.context.renderer.setTerminalTitle("OC | Demo")
  h.state.running.add("ses_child")
  h.emit("session.status")
  await h.tick()
  assert.equal(h.titles.at(-1), "⠋ Demo")

  h.cleanup?.()
})

test("настройки: кривые значения — ошибка загрузки, а не тихий дефолт", () => {
  assert.throws(() => harness({ strip: "(" }), /invalid "strip" regular expression/)
  assert.throws(() => harness({ strip: 42 }), /must be a regular expression string/)
  assert.throws(() => harness({ marker: 42 }), /must be a string/)
  assert.throws(() => harness({ spinner: [1] }), /array of strings/)
  assert.throws(() => harness({ spinnerInterval: 0 }), /positive number/)
})
