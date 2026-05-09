import type { ValidationMessageDto } from "@specops/contracts";

type ValidationPanelProps = {
  messages: ValidationMessageDto[];
};

export function ValidationPanel({ messages }: ValidationPanelProps) {
  const counts = messages.reduce(
    (acc, message) => {
      acc[message.level] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 }
  );

  return (
    <section className="panel-section">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="section-heading">Validation</h2>
        <span className="text-xs text-slate-500">
          {counts.error} errors / {counts.warning} warnings
        </span>
      </div>
      {messages.length > 0 ? (
        <ul className="grid gap-2">
          {messages.map((message) => (
            <li key={message.id} className="rounded border border-slate-200 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={levelClass(message.level)}>{message.level}</span>
                <span className="truncate text-slate-500">{message.code}</span>
              </div>
              <p className="text-slate-700">{message.message}</p>
              <p className="mt-1 truncate text-slate-500">
                {message.entityId ?? message.filePath ?? "project"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No validation messages.</p>
      )}
    </section>
  );
}

function levelClass(level: ValidationMessageDto["level"]) {
  if (level === "error") {
    return "rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800";
  }
  if (level === "warning") {
    return "rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800";
  }
  return "rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800";
}
