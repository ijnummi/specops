import type { EntityReadinessDto, SpecReadinessStatus } from "@specops/contracts";
import { AlertTriangle, CheckCircle2, CircleAlert, HelpCircle } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type StatusMeta = {
  Icon: IconComponent;
  iconClass: string;
  label: string;
};

export function ReadinessPanel({ readiness }: { readiness: EntityReadinessDto }) {
  const meta = statusMeta(readiness.readiness);

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <meta.Icon className={`h-4 w-4 ${meta.iconClass}`} aria-hidden="true" />
        <span>{meta.label}</span>
      </h3>
      {readiness.checks.length === 0 ? (
        <p className="text-sm text-slate-500">No readiness checks need attention.</p>
      ) : (
        <ul className="grid gap-2">
          {readiness.checks.map((check) => (
            <li
              key={`${check.id}-${check.relatedEntityId ?? check.filePath ?? "project"}`}
              className="text-sm text-slate-700"
            >
              <div className="font-medium">{check.label}</div>
              <div className="text-slate-600">{check.detail}</div>
              <div className="text-xs text-slate-500">{check.suggestedFix}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusMeta(status: SpecReadinessStatus): StatusMeta {
  if (status === "ready") {
    return {
      Icon: CheckCircle2,
      iconClass: "text-emerald-600",
      label: "Ready"
    };
  }
  if (status === "blocked") {
    return {
      Icon: CircleAlert,
      iconClass: "text-red-600",
      label: "Blocked"
    };
  }
  if (status === "needs_review") {
    return {
      Icon: AlertTriangle,
      iconClass: "text-amber-600",
      label: "Needs Review"
    };
  }
  return {
    Icon: HelpCircle,
    iconClass: "text-sky-600",
    label: "Needs Context"
  };
}
