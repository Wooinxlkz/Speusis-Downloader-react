import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { ipc } from "@/lib/ipc";

export function LoginsDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const { settings, load } = useSettingsStore();
  const open = dialog === "logins";

  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function add() {
    if (!domain.trim() || !username.trim()) return;
    await ipc.settingsAddCredential({ domain: domain.trim(), username: username.trim(), password });
    setDomain("");
    setUsername("");
    setPassword("");
    await load();
  }

  async function remove(d: string) {
    await ipc.settingsRemoveCredential(d);
    await load();
  }

  return (
    <Modal open={open} onClose={close} width={520}>
      <DialogHeader icon={<KeyRound size={16} />} title="Site logins" subtitle="Credentials used for authenticated downloads" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <TextInput placeholder="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <TextInput placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <TextInput placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button primary onClick={add} disabled={!domain.trim() || !username.trim()}>
          Add credential
        </Button>

        <div className="max-h-56 overflow-y-auto rounded-lg border border-line-soft">
          {(settings?.credentials ?? []).length === 0 && (
            <p className="px-3 py-4 text-center text-[12.5px] text-faint">No saved logins.</p>
          )}
          {settings?.credentials.map((c) => (
            <div key={c.domain} className="flex items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{c.domain}</p>
                <p className="truncate text-[11px] text-faint">{c.username}</p>
              </div>
              <button
                onClick={() => remove(c.domain)}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-1 flex justify-end">
          <Button primary onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
