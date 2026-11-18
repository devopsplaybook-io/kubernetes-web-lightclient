import {
  EventBus,
  EventTypes as CommonEventTypes,
  handleError as commonHandleError,
  type HandleErrorOptions,
} from "@devopsplaybook.io/common-web/composables/EventBus";
import { permissionDenialForError } from "~~/services/PermissionErrors";

export { EventBus };
export const EventTypes = {
  ...CommonEventTypes,
  ITEMS_UPDATED: "ITEMS_UPDATED",
  SOURCES_UPDATED: "SOURCES_UPDATED",
  OBJECT_CHANGED: "OBJECT_CHANGED",
  OPEN_COMMAND_PALETTE: "OPEN_COMMAND_PALETTE",
  OPEN_OBJECT_DETAILS: "OPEN_OBJECT_DETAILS",
} as const;

/**
 * Shared error handler. A 403 is reported once with the actionable
 * "missing scope" message instead of the raw server body; every other error
 * goes through the common-web handler unchanged.
 */
export function handleError(
  error: unknown,
  options: HandleErrorOptions = {},
): void {
  const denial = permissionDenialForError(error);
  if (denial) {
    EventBus.emit(EventTypes.ALERT_MESSAGE, {
      type: "error",
      text: denial.message,
    });
    return;
  }
  commonHandleError(error, options);
}
