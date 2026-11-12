import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ErrorPage from "./error";
import LoadingPage from "./loading";

test("erro não expõe detalhes técnicos e oferece recuperação", () => {
  const html = renderToStaticMarkup(
    <ErrorPage
      error={new Error("Prisma connection failed: segredo")}
      reset={() => {}}
    />,
  );
  expect(html).not.toContain("segredo");
  expect(html).not.toContain("Prisma");
  expect(html).toContain("Tentar novamente");
  expect(renderToStaticMarkup(<LoadingPage />)).toContain('role="status"');
});
