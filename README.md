# Mi Bolso

Inventario personal del bolso de paramédicos. Cada voluntario entra con Google y ve sólo su bolso: qué falta, qué usó en cada emergencia, qué repuso y el historial completo.

**Stack:** Next.js 14 (App Router, todo del lado del cliente) · Firebase Auth (Google) · Cloud Firestore con caché offline · deploy en Vercel desde GitHub.

## Estructura

```
app/            layout, página (login con Google → inventario), estilos
components/     InventoryApp (pantalla principal), Sheet (registrar uso / reponer), History, Controls
lib/inventory.ts  lógica pura: catálogo por defecto, estados, uso/reposición, historial (testeada)
lib/data.ts       acceso a Firestore
lib/firebase.ts   inicialización de Firebase (lazy, sólo en el navegador)
firestore.rules   reglas de seguridad
tests/            tests de la lógica (node --test)
```

## Datos en Firestore

| Ruta | Contenido |
|---|---|
| `users/{uid}` | perfil: nombre, email, foto, creado, último acceso |
| `users/{uid}/bolso/actual` | inventario completo: `catalog`, `valores` (SÍ/NO/nivel), `cant`, `venc`, `schema` |
| `users/{uid}/movimientos/{id}` | historial: `tipo` (`uso` / `repo` / `ajuste`), `t`, `nota`, `cambios[]` con `de → a` |

Cada cambio guarda el inventario y su movimiento en un mismo batch. Los cambios manuales seguidos (menos de 5 minutos) se agrupan en un único movimiento "ajuste". Las reglas sólo dejan a cada usuario leer y escribir su propio `users/{uid}`.

## Puesta en marcha

### 1. Firebase
1. [console.firebase.google.com](https://console.firebase.google.com) → **Agregar proyecto** (Analytics no hace falta).
2. **Authentication → Comenzar → Google** → habilitar → elegir email de soporte → Guardar.
3. **Firestore Database → Crear base de datos** → ubicación `southamerica-east1` (São Paulo) → modo producción.
4. Firestore → pestaña **Reglas** → pegar el contenido de `firestore.rules` → **Publicar**.
5. **Configuración del proyecto (⚙) → Tus apps → `</>` (Web)** → registrar la app (sin Hosting) → copiar los valores de `firebaseConfig`.

### 2. Vercel
1. [vercel.com](https://vercel.com) → entrar con GitHub → **Add New → Project** → importar `MibolsoHATZALAH/mi-bolso`.
2. Framework: Next.js (se detecta solo). En **Environment Variables** cargar las 6 variables de `.env.example` con los valores de `firebaseConfig`.
3. **Deploy**. Vercel publica en `<proyecto>.vercel.app` y redeploya en cada push a la rama de producción.

### 3. Dominio autorizado
Firebase → Authentication → **Configuración → Dominios autorizados** → agregar el dominio de Vercel (por ejemplo `mi-bolso.vercel.app`). Sin esto, el login con Google falla.

## Desarrollo local

```bash
cp .env.example .env.local   # completar con firebaseConfig
npm install
npm run dev                  # http://localhost:3000 (localhost ya está autorizado en Firebase)
npm test                     # lógica del inventario
```

## Migrar desde la versión anterior

La versión anterior (un único `index.html` que guardaba en el navegador) tiene en Historial "Copiar como texto" / "Descargar copia". En la app nueva: Historial → **Importar de la app anterior**. Reemplaza el inventario e importa su historial.
