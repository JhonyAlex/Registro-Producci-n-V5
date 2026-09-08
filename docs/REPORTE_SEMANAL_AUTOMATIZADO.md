# Reporte semanal automatizado de producción

## Estado objetivo

El reporte semanal se genera desde la aplicación Registro Producción Pigmea V5 y se envía mediante Resend.

- Destinatario por defecto: `jhonyalexalvarez@gmail.com`
- Remitente: `Producción Pigmea <produccion@notificaciones.pigmea.click>`
- Programación: martes a las 08:00
- Zona horaria: `Europe/Madrid`
- Cron Dokploy: `0 8 * * 2`
- Periodo reportado: semana natural anterior completa, lunes a domingo
- Comando programado: `npm run report:weekly`

## Asunto y cuerpo

El asunto incluye la semana del mes tomando como referencia el domingo de cierre del periodo.

Ejemplo:

`Registro Producción Pigmea V5 — Semana 1 de septiembre de 2026 — 31/08/2026 al 06/09/2026`

El cuerpo también indica la semana del mes y el rango exacto.

## Orden de secciones

El orden es fijo y no depende de la base de datos:

1. Impresión
2. Laminación
3. Rebobinado

Los grupos de máquinas se toman de `shared/machineGroups.ts`.

### Impresión

- WH1
- WH3
- Giave

### Laminación

- NEXUS
- SL2
- SL2 EVO

### Rebobinado

- S2DT
- 21
- 22
- PROSLIT

## Gráficas enviadas

Cada línea genera cinco gráficas, para un total de 15 imágenes inline CID:

1. Producción por Máquina
2. Producción por turno
3. Metros por Operario
4. Tendencia — Metros vs Cambios de pedido
5. Cambios de pedido por Operario

La representación visual del email es estable. La configuración del Dashboard Principal solo aporta la regla semántica activa para la métrica equivalente mediante `groupBy + valueField`.

### Métrica de metros

Las gráficas de metros heredan la regla activa del Dashboard Principal. La configuración validada en septiembre de 2026 utiliza la regla `Suma Giave Film/Papel` con:

- `meters`
- `dynamic.metros-film`
- `dynamic.metros-papel`

### Cambios de pedido

Se usa `changesCount` con agregación `sum`.

- Tendencia: Metros vs Cambios de pedido por fecha.
- Cambios de pedido por Operario: `changesCount` agrupado por `operator`.

## Filtros aplicados

El reporte automático aplica únicamente:

- rango de fecha: `date >= lunes` y `date <= domingo`;
- grupo de máquinas de la línea correspondiente.

No reutiliza filtros manuales que un usuario haya dejado seleccionados en la interfaz. No filtra por jefe, turno, operario o usuario creador salvo que se implemente expresamente en el reporte.

## Variables de entorno requeridas

Nunca versionar valores reales de secretos.

```env
RESEND_API_KEY=
REPORT_FROM="Producción Pigmea <produccion@notificaciones.pigmea.click>"
REPORT_TO=jhonyalexalvarez@gmail.com
REPORT_REPLY_TO=jhonyalexalvarez@gmail.com
REPORT_RENDER_SECRET=
REPORT_BASE_URL=http://127.0.0.1:3000
```

`DATABASE_URL` sigue siendo la conexión normal de producción de la aplicación.

## Ejecución manual

Semana anterior automáticamente:

```bash
npm run report:weekly
```

Rango concreto:

```bash
npm run report:weekly -- --from 2026-08-31 --to 2026-09-06
```

Previsualización sin enviar:

```bash
npm run report:weekly -- --dry-run --from 2026-08-31 --to 2026-09-06
```

Reenvío intencional de un periodo y destinatario ya marcado como enviado:

```bash
npm run report:weekly -- --force --from 2026-08-31 --to 2026-09-06
```

Usar `--force` solo cuando se quiera un duplicado deliberado.

## Idempotencia

La tabla `report_email_runs` evita repetir el mismo reporte para la misma combinación de:

- tipo de reporte;
- fecha inicial;
- fecha final;
- destinatario.

## Cómo pedir futuros cambios al orquestador

No es necesario describir la implementación técnica. Indicar únicamente el cambio funcional deseado y, cuando aplique, la línea, métrica, agrupación o calendario.

### Añadir una gráfica

Ejemplo:

> En el reporte semanal añade después de Metros por Operario una gráfica de cambios de pedido por máquina. Debe aparecer en las tres líneas y mantener el resto igual.

Si la nueva gráfica depende de un campo ambiguo, indicar el campo exacto o pedir al orquestador que verifique primero el Dashboard y la base de datos.

### Cambiar un filtro

Ejemplo:

> En el reporte semanal excluye el turno Noche únicamente de Laminación. No cambies las otras líneas ni las gráficas.

O:

> Quiero que el reporte semanal solo incluya los operarios X e Y en Impresión.

### Cambiar la fecha u hora de envío

Ejemplo:

> Cambia el reporte semanal de los martes a las 08:00 a los miércoles a las 09:30, manteniendo Europe/Madrid y reportando siempre la semana anterior.

### Cambiar destinatarios

Ejemplo:

> Añade `usuario@dominio.com` como segundo destinatario del reporte semanal sin quitar el Gmail actual.

### Cambiar el periodo

Ejemplo:

> Quiero que el reporte mensual se envíe el día 1 y cubra el mes natural anterior. No cambies el reporte semanal existente.

## Flujo obligatorio para cambios futuros

1. Revisar `AGENTS.md`, estado de ClickUp y esta guía.
2. Verificar el Dashboard/configuración real si la métrica depende de reglas dinámicas.
3. Implementar en rama separada.
4. Ejecutar tests y build.
5. Hacer dry-run contra un clon de producción cuando cambien gráficas, métricas o filtros.
6. Enviar una prueba real al destinatario de validación si cambia el contenido del email.
7. Solo después fusionar y desplegar.
8. Actualizar ClickUp y esta documentación si cambia el comportamiento estable.

## Evidencias de validación de la versión inicial

- Commit funcional validado antes de producción: `e470f3c71d22d9bdedcde59e140f91a552f5791a`
- Tests: 43/43 OK
- Build: OK
- Dry-run real sobre clon de producción: 15/15 PNG, `report.html`, 277.590 bytes de gráficas
- Envío real de validación a Gmail confirmado por el usuario
- Resend ID de validación final: `7d952560-bdc9-4ff0-8f17-ba8bd4d280a0`
