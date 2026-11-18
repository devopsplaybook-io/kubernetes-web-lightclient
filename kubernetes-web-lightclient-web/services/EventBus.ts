import {
  EventBus,
  EventTypes as CommonEventTypes,
  handleError,
} from "@devopsplaybook.io/common-web/composables/EventBus";

export { EventBus, handleError };
export const EventTypes = {
  ...CommonEventTypes,
  ITEMS_UPDATED: "ITEMS_UPDATED",
  SOURCES_UPDATED: "SOURCES_UPDATED",
  OBJECT_CHANGED: "OBJECT_CHANGED",
  OPEN_COMMAND_PALETTE: "OPEN_COMMAND_PALETTE",
  OPEN_OBJECT_DETAILS: "OPEN_OBJECT_DETAILS",
} as const;
