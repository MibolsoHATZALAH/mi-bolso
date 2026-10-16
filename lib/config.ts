// Settings shared by the app and the daily alarm job (scripts/alarmas.ts). No Firebase imports here.

/** Always allowed into the shared bags, with the management role. Keep in sync with admin() in firestore.rules. */
export const ADMINS = ["urielchirazi@gmail.com"];

/** Public address of the published app (GitHub Pages). */
export const APP_URL = "https://mibolsohatzalah.github.io/mi-bolso";

/** Hours between "this bag has missing items" alarms. */
export const FALTANTES_CADA_HORAS = 48;

/** Public "Web Push certificate" key of the Firebase project (Cloud Messaging). Public by design. */
export const VAPID_KEY = "BBx-Oso7SaBkdUr7Tspdmy1hAdCOO8VqFqYr7jknams10KU1KldqoyiwWw_hT9RcHF8pBo0JsZpnf7cqNlGji_8";

/** Neighborhoods of the shared bags, in the order the institution's spreadsheet lists them. */
export const BARRIOS = ["Congreso", "Once", "Flores", "Palermo", "Belgrano", "Barracas", "Paternal", "Villa Crespo / Chacarita", "Otros"];

/** Extra equipment some places have, shown as small logos on the bag's card (only "has it / doesn't"). */
export const EQUIPOS = [
  { id: "dea", nombre: "DEA" },
  { id: "silla", nombre: "Silla de ruedas" },
  { id: "tabla", nombre: "Tabla rígida" },
  { id: "chaleco", nombre: "Chaleco de trauma" },
  { id: "rem", nombre: "Bolso REM" },
] as const;
export type EquipoId = (typeof EQUIPOS)[number]["id"];
