<div align="center">
  <div style="background-color:#1a1a2e;padding:40px 60px;border-radius:12px;display:inline-block;margin-bottom:16px;">
    <img width="320" alt="Logo Pigmea" src="public/logo-white.png" />
  </div>
  <h1>Registro Producción Pigmea — V5</h1>
  <p><strong>Sistema web de registro y gestión de producción industrial en tiempo real</strong></p>
  <p>
    <img alt="React" src="https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white" />
    <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-Realtime-010101?logo=socket.io&logoColor=white" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite&logoColor=white" />
    <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  </p>
</div>

---

## Descripción general

**Registro Producción Pigmea V5** es una aplicación web full-stack diseñada para gestionar y registrar la producción industrial de la empresa Pigmea. Permite a operarios, jefes de planta y administradores registrar turnos, consultar dashboards analíticos, exportar reportes y administrar usuarios — todo en tiempo real con sincronización offline.

---

## Características principales

### Gestión de producción
- Registro de turnos por máquina y turno (Mañana / Tarde / Noche)
- Máquinas soportadas: `WH1`, `Giave`, `WH3`, `NEXUS`, `SL2`, `21`, `22`, `S2DT`, `PROSLIT`
- Campos dinámicos por máquina configurables desde el panel de administración
- Edición y eliminación de registros con trazabilidad completa

### Autenticación y roles
- Registro de usuarios con flujo de aprobación (sala de espera)
- Roles: `admin`, `jefe_planta`, `operario`
- Autenticación con JWT + cookies seguras (bcrypt + jsonwebtoken)
- Matriz de permisos granular por rol

### Dashboard analítico
- Gráficas de producción con [Recharts](https://recharts.org/)
- Filtros por fecha, máquina, jefe y operario
- Dashboards personalizables gestionados desde el panel de administración

### Tiempo real y modo offline
- Actualizaciones en tiempo real vía **Socket.IO**
- Cola de sincronización offline: los registros se almacenan localmente y se sincronizan al recuperar la conexión

### Exportación e importación
- Exportación a **Excel** (xlsx) y **PDF** (jsPDF + jspdf-autotable, html2canvas)
- Exportación e importación completa del estado de la base de datos (JSON)

### Seguridad adicional
- Pantalla de bloqueo global por inactividad (60 segundos)
- Desbloqueo por clic (desktop) o gesto deslizar hacia arriba (móvil)
- Frase motivacional del día con dataset de 30 frases en rotación

### Administración
- Gestión de usuarios (aprobar, suspender, asignar roles y permisos)
- Registros de auditoría completos de todas las acciones
- Gestor de esquemas de campos dinámicos por máquina con versionado

---

## Tecnologías utilizadas

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, TypeScript, Vite 6, Lucide React |
| Backend | Node.js, Express 5, TypeScript (tsx) |
| Base de datos | PostgreSQL (driver `pg`) |
| Tiempo real | Socket.IO 4 |
| Autenticación | JWT, bcrypt, cookie-parser |
| Gráficas | Recharts 2 |
| Exportación | jsPDF, jspdf-autotable, xlsx, html2canvas |
| Tests | Vitest 3, @testing-library/react, jsdom |
| Despliegue | Docker, Docker Compose |

---

## Estructura del proyecto

```
├── App.tsx                   # Componente raíz y lógica principal de vistas
├── constants.ts              # Constantes globales (máquinas, turnos, comentarios)
├── types.ts                  # Tipos e interfaces TypeScript
├── server.ts                 # Servidor Express + Socket.IO + API REST
├── index.tsx / index.html    # Punto de entrada React
├── vite.config.ts            # Configuración de Vite
├── vitest.config.ts          # Configuración de tests
├── docker-compose.yml        # Orquestación Docker
├── Dockerfile                # Imagen Docker de la app
│
├── components/               # Componentes React
│   ├── AdminUsers.tsx        # Gestión de usuarios
│   ├── AuditLogs.tsx         # Registros de auditoría
│   ├── Dashboard.tsx         # Dashboard analítico
│   ├── DashboardManager.tsx  # Administrador de dashboards
│   ├── GlobalLockScreenGuard.tsx  # Guardia global de pantalla de bloqueo
│   ├── Login.tsx             # Inicio de sesión
│   ├── MachineFieldManager.tsx    # Gestor de campos dinámicos por máquina
│   ├── PigmeaLockScreen.tsx  # Pantalla de bloqueo con animación
│   ├── Register.tsx          # Registro de usuarios
│   ├── RolePermissionsMatrix.tsx  # Matriz de permisos por rol
│   ├── ShiftForm.tsx         # Formulario de registro de turno
│   ├── UserProfile.tsx       # Perfil de usuario
│   └── WaitingRoom.tsx       # Sala de espera (aprobación)
│
├── context/
│   └── AuthContext.tsx       # Contexto global de autenticación
│
├── services/
│   ├── offlineQueue.ts       # Cola de sincronización offline
│   ├── socket.ts             # Cliente Socket.IO
│   └── storageService.ts     # Servicio de persistencia (API calls)
│
├── hooks/
│   └── useInactivityLock.ts  # Hook de detección de inactividad
│
├── utils/
│   └── dailyPhrase.ts        # Rotación diaria de frases motivacionales
│
├── data/
│   └── motivationalPhrases.json  # Dataset de 30 frases
│
├── tests/
│   ├── dailyPhrase.test.ts
│   ├── PigmeaLockScreen.test.tsx
│   └── useInactivityLock.test.tsx
│
└── docs/
    └── REGISTRO_PRODUCCION_PIGMEA_IMPLEMENTACION.md
```

---

## Requisitos previos

- **Node.js** v18 o superior
- **PostgreSQL** (o Docker para levantar la base de datos automáticamente)

---

## Instalación y ejecución local

### Opción A — Sin Docker

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/JhonyAlex/Registro-Producci-n-V5.git
   cd Registro-Producci-n-V5
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno** — crear un archivo `.env` en la raíz:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pigmea
   JWT_SECRET=tu_secreto_jwt_seguro
   ```

4. **Iniciar el servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   La aplicación estará disponible en `http://localhost:3000`.

### Opción B — Con Docker Compose

```bash
docker-compose up --build
```

Esto levanta la aplicación y una instancia de PostgreSQL automáticamente.

---

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo (Express + Vite) |
| `npm run build` | Compilar el bundle de producción |
| `npm run start` | Ejecutar en modo producción |
| `npm run preview` | Vista previa del build |
| `npm run test` | Ejecutar tests con Vitest |
| `npm run test:watch` | Tests en modo observador |
| `npm run test:ui` | Interfaz visual de Vitest |

---

## Documentación adicional

- [Implementación de la pantalla de bloqueo](docs/REGISTRO_PRODUCCION_PIGMEA_IMPLEMENTACION.md)

---

## Créditos

Desarrollado con dedicación por:

| Rol | Persona / Organización |
|-----|----------------------|
| Desarrollo y arquitectura | **Jhony Alvarez** |
| Soporte tecnológico y digital | [**Cambiodigital.net**](https://cambiodigital.net) |

---

<div align="center">
  <sub>© 2026 Jhony Alvarez · <a href="https://cambiodigital.net">Cambiodigital.net</a> · Todos los derechos reservados.</sub>
</div>
