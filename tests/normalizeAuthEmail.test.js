import { normalizeAuthEmail } from "../src/utils/normalizeAuthEmail.js";

describe("normalizeAuthEmail", () => {
  test("usa la identidad canonica de Gmail sin puntos ni subdireccion", () => {
    expect(normalizeAuthEmail(" I.POUK.19+prueba@googlemail.com ")).toBe(
      "ipouk19@gmail.com",
    );
  });

  test("normaliza mayusculas sin alterar dominios comunes", () => {
    expect(normalizeAuthEmail("Atleta@Example.com")).toBe(
      "atleta@example.com",
    );
  });
});

