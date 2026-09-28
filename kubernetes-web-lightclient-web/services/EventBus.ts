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
} as const;
