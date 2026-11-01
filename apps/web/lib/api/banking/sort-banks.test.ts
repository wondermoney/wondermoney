import assert from "node:assert/strict";

import { test } from "vitest";

import { sortBanksForCountry } from "./sort-banks";

const bank = (name: string) => ({
  id: name.toUpperCase(),
  logo: "",
  name,
  country: "PT",
});

const names = (banks: ReturnType<typeof sortBanksForCountry>) =>
  banks.map((b) => b.name);

test("PT: the banks people actually use come before the alphabetical tail", () => {
  // Alphabetical, as the provider returns it: Abanca first.
  const fromProvider = [
    bank("Abanca"),
    bank("Abanca Corporate"),
    bank("Banco BPI"),
    bank("Banco Santander"),
    bank("Caixa Geral De Depositos"),
    bank("Revolut"),
  ];

  assert.deepEqual(names(sortBanksForCountry(fromProvider, "PT")), [
    "Revolut",
    "Banco Santander",
    "Caixa Geral De Depositos",
    "Banco BPI",
    "Abanca",
    "Abanca Corporate",
  ]);
});

test("matches across spacing and casing variants of the same brand", () => {
  const sorted = sortBanksForCountry(
    [bank("Zzz Bank"), bank("Activo Bank"), bank("Banco ActivoBank")],
    "PT",
  );
  // Both ActivoBank spellings rank ahead of the unranked bank.
  assert.deepEqual(names(sorted), ["Activo Bank", "Banco ActivoBank", "Zzz Bank"]);
});

test("unranked banks stay alphabetical among themselves", () => {
  const sorted = sortBanksForCountry(
    [bank("Zeta Bank"), bank("Alpha Bank"), bank("Mu Bank")],
    "PT",
  );
  assert.deepEqual(names(sorted), ["Alpha Bank", "Mu Bank", "Zeta Bank"]);
});

test("a country with no priority list is purely alphabetical", () => {
  const sorted = sortBanksForCountry(
    [bank("Zeta"), bank("Revolut"), bank("Alpha")],
    "DE",
  );
  assert.deepEqual(names(sorted), ["Alpha", "Revolut", "Zeta"]);
});

test("country code is case-insensitive", () => {
  assert.deepEqual(
    names(sortBanksForCountry([bank("Abanca"), bank("Revolut")], "pt")),
    ["Revolut", "Abanca"],
  );
});

test("does not mutate the input", () => {
  const input = [bank("Abanca"), bank("Revolut")];
  const before = names(input);
  sortBanksForCountry(input, "PT");
  assert.deepEqual(names(input), before);
});

test("Montepio does not get mistaken for Caixa Geral", () => {
  const sorted = sortBanksForCountry(
    [bank("Caixa Economica Montepio Geral"), bank("Caixa Geral De Depositos")],
    "PT",
  );
  assert.deepEqual(names(sorted), [
    "Caixa Geral De Depositos",
    "Caixa Economica Montepio Geral",
  ]);
});

test("empty list is handled", () => {
  assert.deepEqual(sortBanksForCountry([], "PT"), []);
});
