import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AnalystControls } from "./analyst-controls";

test("controles seguem estado e responsável", () => {
  const render = (
    status: "AGENT" | "WAITING_FOR_ANALYST" | "ANALYST" | "CLOSED",
    assignedId: string | null,
  ) =>
    renderToStaticMarkup(
      <AnalystControls
        status={status}
        assignedId={assignedId}
        analystId="n1"
        busy={false}
        onAction={() => {}}
      />,
    );
  expect(render("WAITING_FOR_ANALYST", null)).toContain("Assumir atendimento");
  expect(render("ANALYST", "n1")).toContain("Devolver ao agent");
  expect(render("ANALYST", "n1")).toContain("Encerrar atendimento");
  expect(render("ANALYST", "n2")).not.toContain("<button");
  expect(render("CLOSED", "n1")).not.toContain("<button");
  expect(render("AGENT", null)).not.toContain("<button");
});
