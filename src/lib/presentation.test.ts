import { expect, test } from "vitest";
import { formatDate, readableDecisionText } from "./presentation";

test("datas usam São Paulo independentemente do fuso do navegador", () => {
  expect(formatDate("2026-11-13T14:00:00.000Z")).toBe("13/11 às 11:00");
  expect(
    readableDecisionText("Prazo 2026-11-13T14:00:00.000Z; prioridade HIGH."),
  ).toBe("Prazo 13/11 às 11:00; prioridade Alta.");
});
test("apresentação omite cuid, preserva número público e traduz contexto", () => {
  const technical =
    "Persistiu rascunho cmwe09xfb0011tnk01bt485hj de CREATE para INC-100001. SELF, stopped.";
  expect(readableDecisionText(technical)).toBe(
    "Persistiu rascunho de criação para INC-100001. Somente você, trabalho parado.",
  );
  expect(technical).toContain("cmwe09xfb0011tnk01bt485hj");
});
