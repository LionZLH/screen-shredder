export function isDesktop() {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

async function api() {
  const core = await import("@tauri-apps/api/core");
  const event = await import("@tauri-apps/api/event");
  return { invoke: core.invoke, listen: event.listen };
}

export async function connectDesktop() {
  if (!isDesktop()) return null;
  const { invoke, listen } = await api();
  await invoke("ready");
  return {
    async pointer() {
      return invoke("pointer");
    },
    async setPassThrough(pass) {
      await invoke("set_pass_through", { pass });
    },
    async pin() {
      await invoke("pin_window");
    },
    haptic(pattern = 1) {
      invoke("haptic", { pattern }).catch(() => {});
    },
    async trash(paths) {
      return invoke("move_to_trash", { paths });
    },
    async pickFiles() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        title: "放进回收站的文件",
      });
      if (!picked) return [];
      return Array.isArray(picked) ? picked : [picked];
    },
    async pickFolder() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: true,
        title: "整夹放进回收站的文件夹",
      });
      if (!picked) return [];
      return Array.isArray(picked) ? picked : [picked];
    },
    onMenu(kind, handler) {
      return listen(kind, handler);
    },
    onTrash(handler) {
      return listen("trash-incoming", (event) => handler(event.payload));
    },
    onDrag(handler) {
      return import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => handler(event.payload)),
      );
    },
  };
}
