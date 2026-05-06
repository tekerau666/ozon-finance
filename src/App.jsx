import React, { useEffect, useMemo, useState } from "react";
import { read, utils } from "xlsx";

const EXPENSE_CATEGORIES = [
  "Такси до ФФ",
  "Такси до Озон",
  "Закупка товара",
  "Личные расходы",
  "Возвраты",
  "Налоги",
  "Дизайн",
  "Прочее",
];

const STORAGE_KEY = "ozon-business-accounting-v1";
const DISPOSAL_STORAGE_KEY = "ozon-disposal-accounting-v1";

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatRub(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function normalizeNumber(value) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function normalizeHeader(value) {
  return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("ё", "е");
}

function parseDisposalRows(rows) {
  const headerRowIndex = rows.findIndex((row) =>
      row.some((cell) => normalizeHeader(cell) === "артикул")
  );

  if (headerRowIndex === -1) {
    throw new Error("Не нашел колонку «Артикул» в файле.");
  }

  const headers = rows[headerRowIndex].map(normalizeHeader);

  const articleIndex = headers.findIndex((header) => header === "артикул");
  const quantityIndex = headers.findIndex((header) =>
      header.includes("количество")
  );

  if (articleIndex === -1 || quantityIndex === -1) {
    throw new Error("Не нашел колонки «Артикул» или «Количество».");
  }

  const result = {};

  for (const row of rows.slice(headerRowIndex + 1)) {
    const article = String(row[articleIndex] || "").trim();
    const quantity = normalizeNumber(row[quantityIndex]);

    if (!article || quantity <= 0) continue;

    result[article] = {
      article,
      quantity: (result[article]?.quantity || 0) + quantity,
      cost: result[article]?.cost || "",
    };
  }

  return Object.values(result).sort((a, b) =>
      a.article.localeCompare(b.article, "ru")
  );
}

function downloadFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function OzonFinanceApp() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [expenses, setExpenses] = useState([]);
  const [monthlyProfit, setMonthlyProfit] = useState({});
  const [disposalByMonth, setDisposalByMonth] = useState({});
  const [disposalError, setDisposalError] = useState("");

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    category: EXPENSE_CATEGORIES[0],
    comment: "",
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.expenses) setExpenses(saved.expenses);
      if (saved?.monthlyProfit) setMonthlyProfit(saved.monthlyProfit);

      const savedDisposal = JSON.parse(
          localStorage.getItem(DISPOSAL_STORAGE_KEY)
      );
      if (savedDisposal) setDisposalByMonth(savedDisposal);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(DISPOSAL_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ expenses, monthlyProfit })
    );
  }, [expenses, monthlyProfit]);

  useEffect(() => {
    localStorage.setItem(
        DISPOSAL_STORAGE_KEY,
        JSON.stringify(disposalByMonth)
    );
  }, [disposalByMonth]);

  const monthExpenses = useMemo(() => {
    return expenses
        .filter((expense) => expense.date?.startsWith(selectedMonth))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [expenses, selectedMonth]);

  const totalExpenses = useMemo(() => {
    return monthExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount),
        0
    );
  }, [monthExpenses]);

  const disposalItems = disposalByMonth[selectedMonth] || [];

  const disposalTotal = useMemo(() => {
    return disposalItems.reduce((sum, item) => {
      return sum + normalizeNumber(item.quantity) * normalizeNumber(item.cost);
    }, 0);
  }, [disposalItems]);

  const totalExpensesWithDisposal = totalExpenses + disposalTotal;

  const ozonProfit = normalizeNumber(monthlyProfit[selectedMonth] || 0);
  const finalProfit = ozonProfit - totalExpensesWithDisposal;

  const categorySummary = useMemo(() => {
    const summary = {};

    for (const expense of monthExpenses) {
      summary[expense.category] =
          (summary[expense.category] || 0) + Number(expense.amount);
    }

    return Object.entries(summary).sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);

  function addExpense(event) {
    event.preventDefault();
    const amount = normalizeNumber(form.amount);

    if (!amount || amount <= 0) return;

    setExpenses((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        date: form.date,
        amount,
        category: form.category,
        comment: form.comment.trim(),
        createdAt: new Date().toISOString(),
      },
    ]);

    setForm((current) => ({ ...current, amount: "", comment: "" }));
  }

  function deleteExpense(id) {
    setExpenses((current) => current.filter((expense) => expense.id !== id));
  }

  async function importDisposalFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setDisposalError("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = read(arrayBuffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const rows = utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      const parsedItems = parseDisposalRows(rows);

      setDisposalByMonth((current) => {
        const oldItems = current[selectedMonth] || [];
        const oldCosts = Object.fromEntries(
            oldItems.map((item) => [item.article, item.cost])
        );

        return {
          ...current,
          [selectedMonth]: parsedItems.map((item) => ({
            ...item,
            cost: oldCosts[item.article] || "",
          })),
        };
      });

      event.target.value = "";
    } catch (error) {
      setDisposalError(error.message || "Не удалось прочитать файл.");
    }
  }

  function updateDisposalCost(article, cost) {
    setDisposalByMonth((current) => ({
      ...current,
      [selectedMonth]: (current[selectedMonth] || []).map((item) =>
          item.article === article ? { ...item, cost } : item
      ),
    }));
  }

  function clearDisposalItems() {
    setDisposalByMonth((current) => ({
      ...current,
      [selectedMonth]: [],
    }));
  }

  function exportJson() {
    const data = {
      selectedMonth,
      ozonProfit,
      manualExpenses: totalExpenses,
      disposalTotal,
      totalExpenses: totalExpensesWithDisposal,
      finalProfit,
      expenses: monthExpenses,
      disposalItems: disposalItems.map((item) => ({
        article: item.article,
        quantity: item.quantity,
        cost: normalizeNumber(item.cost),
        total: normalizeNumber(item.quantity) * normalizeNumber(item.cost),
      })),
      categorySummary,
    };

    downloadFile(
        `ozon-finance-${selectedMonth}.json`,
        JSON.stringify(data, null, 2),
        "application/json"
    );
  }

  function exportCsv() {
    const rows = [
      ["Дата", "Категория", "Сумма", "Комментарий"],
      ...monthExpenses.map((expense) => [
        expense.date,
        expense.category,
        expense.amount,
        expense.comment,
      ]),
    ];

    const csv = rows
        .map((row) =>
            row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")
        )
        .join("\n");

    downloadFile(
        `ozon-expenses-${selectedMonth}.csv`,
        csv,
        "text/csv;charset=utf-8"
    );
  }

  return (
      <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Учет бизнеса на Ozon
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                  Финансовый результат за месяц
                </h1>
                <p className="mt-3 max-w-2xl text-slate-600">
                  Вноси расходы в течение месяца, затем добавь чистую прибыль из
                  кабинета Ozon. Приложение посчитает итог с учетом всех
                  дополнительных расходов и утилизации товара.
                </p>
              </div>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Месяц учета
                <input
                    type="month"
                    value={selectedMonth}
                    onChange={(event) => setSelectedMonth(event.target.value)}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
            </div>
          </header>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm font-medium text-slate-500">
                Чистая прибыль с Ozon
              </p>
              <input
                  inputMode="decimal"
                  value={monthlyProfit[selectedMonth] || ""}
                  onChange={(event) =>
                      setMonthlyProfit((current) => ({
                        ...current,
                        [selectedMonth]: event.target.value,
                      }))
                  }
                  placeholder="Например: 250000"
                  className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-lg font-semibold outline-none transition focus:border-slate-900"
              />
              <p className="mt-2 text-xs text-slate-500">
                Это сумма, которую ты берешь из аналитики/отчета Ozon после
                расходов маркетплейса.
              </p>
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm font-medium text-slate-500">
                Дополнительные расходы
              </p>
              <p className="mt-3 text-3xl font-bold text-red-600">
                {formatRub(totalExpensesWithDisposal)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Ручные расходы: {formatRub(totalExpenses)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Утилизация товара: {formatRub(disposalTotal)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Всего ручных записей: {monthExpenses.length}
              </p>
            </div>

            <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-sm">
              <p className="text-sm font-medium text-slate-300">
                Итоговая чистая прибыль
              </p>
              <p
                  className={`mt-3 text-3xl font-bold ${
                      finalProfit >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
              >
                {formatRub(finalProfit)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Формула: прибыль Ozon − ручные расходы − утилизация товара.
              </p>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-bold">Утилизация товара</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Загрузи отчет Ozon по списанным товарам. Приложение соберет
                  уникальные артикулы, сложит количество по каждому артикулу и
                  посчитает сумму по себестоимости.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:items-end">
                <label className="cursor-pointer rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Загрузить XLSX
                  <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={importDisposalFile}
                      className="hidden"
                  />
                </label>

                {disposalItems.length > 0 && (
                    <button
                        type="button"
                        onClick={clearDisposalItems}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
                    >
                      Очистить
                    </button>
                )}
              </div>
            </div>

            {disposalError && (
                <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
                  {disposalError}
                </div>
            )}

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              {disposalItems.length === 0 ? (
                  <div className="p-6 text-center text-slate-500">
                    Пока не загружен отчет по утилизации за выбранный месяц.
                  </div>
              ) : (
                  <div className="divide-y divide-slate-200">
                    <div className="hidden bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 sm:grid sm:grid-cols-[1fr_100px_180px_160px] sm:gap-4">
                      <span>Артикул</span>
                      <span>Кол-во</span>
                      <span>Себестоимость</span>
                      <span className="text-right">Сумма</span>
                    </div>

                    {disposalItems.map((item) => {
                      const itemTotal =
                          normalizeNumber(item.quantity) * normalizeNumber(item.cost);

                      return (
                          <div
                              key={item.article}
                              className="grid gap-3 p-4 sm:grid-cols-[1fr_100px_180px_160px] sm:items-center sm:gap-4"
                          >
                            <div>
                              <p className="font-semibold">{item.article}</p>
                              <p className="mt-1 text-sm text-slate-500 sm:hidden">
                                Кол-во: {item.quantity}
                              </p>
                            </div>

                            <p className="hidden text-sm text-slate-600 sm:block">
                              {item.quantity}
                            </p>

                            <input
                                inputMode="decimal"
                                value={item.cost}
                                onChange={(event) =>
                                    updateDisposalCost(item.article, event.target.value)
                                }
                                placeholder="Например: 4500"
                                className="rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                            />

                            <p className="font-bold text-red-600 sm:text-right">
                              {formatRub(itemTotal)}
                            </p>
                          </div>
                      );
                    })}

                    <div className="flex items-center justify-between gap-4 bg-slate-950 p-4 text-white">
                      <p className="font-semibold">Итого утилизация</p>
                      <p className="text-xl font-bold">{formatRub(disposalTotal)}</p>
                    </div>
                  </div>
              )}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <form
                onSubmit={addExpense}
                className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
            >
              <h2 className="text-xl font-bold">Добавить расход</h2>

              <div className="mt-5 grid gap-4">
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Дата
                  <input
                      type="date"
                      value={form.date}
                      onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            date: event.target.value,
                          }))
                      }
                      className="rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Сумма расхода
                  <input
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                      }
                      placeholder="Например: 3490"
                      className="rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Категория
                  <select
                      value={form.category}
                      onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            category: event.target.value,
                          }))
                      }
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-900"
                  >
                    {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Комментарий
                  <textarea
                      value={form.comment}
                      onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            comment: event.target.value,
                          }))
                      }
                      placeholder="Например: коробки для партии, реклама SKU, доставка поставщика"
                      rows={4}
                      className="resize-none rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </label>

                <button
                    type="submit"
                    className="rounded-2xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800"
                >
                  Сохранить расход
                </button>
              </div>
            </form>

            <div className="space-y-6">
              <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-bold">Расходы за месяц</h2>
                  <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={exportCsv}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
                    >
                      CSV
                    </button>
                    <button
                        type="button"
                        onClick={exportJson}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
                    >
                      JSON
                    </button>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                  {monthExpenses.length === 0 ? (
                      <div className="p-6 text-center text-slate-500">
                        Пока нет расходов за выбранный месяц.
                      </div>
                  ) : (
                      <div className="divide-y divide-slate-200">
                        {monthExpenses.map((expense) => (
                            <div
                                key={expense.id}
                                className="grid gap-3 p-4 sm:grid-cols-[120px_1fr_auto_auto] sm:items-center"
                            >
                              <p className="text-sm text-slate-500">{expense.date}</p>

                              <div>
                                <p className="font-semibold">{expense.category}</p>
                                {expense.comment && (
                                    <p className="mt-1 text-sm text-slate-500">
                                      {expense.comment}
                                    </p>
                                )}
                              </div>

                              <p className="font-bold text-red-600">
                                − {formatRub(expense.amount)}
                              </p>

                              <button
                                  type="button"
                                  onClick={() => deleteExpense(expense.id)}
                                  className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                              >
                                Удалить
                              </button>
                            </div>
                        ))}
                      </div>
                  )}
                </div>
              </section>

              <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xl font-bold">Расходы по категориям</h2>

                <div className="mt-5 space-y-3">
                  {categorySummary.length === 0 ? (
                      <p className="text-slate-500">
                        Категории появятся после добавления расходов.
                      </p>
                  ) : (
                      categorySummary.map(([category, amount]) => {
                        const percent = totalExpenses
                            ? Math.round((amount / totalExpenses) * 100)
                            : 0;

                        return (
                            <div key={category}>
                              <div className="mb-1 flex items-center justify-between gap-4 text-sm">
                                <span className="font-medium">{category}</span>
                                <span className="text-slate-500">
                            {formatRub(amount)} · {percent}%
                          </span>
                              </div>

                              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className="h-full rounded-full bg-slate-900"
                                    style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                        );
                      })
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      </main>
  );
}