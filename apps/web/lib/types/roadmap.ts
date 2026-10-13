export enum RoadmapStatus {
  UNDER_REVIEW = "Under Review",
  PLANNED = "Planned",
  IN_PROGRESS = "In Progress",
  SHIPPED = "Shipped",
}

export type RoadmapStatusType = keyof typeof RoadmapStatus;
