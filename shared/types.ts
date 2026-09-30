export interface Service {
  id: string;
  siteId: string;
  name: string;
  durationMinutes: number;
  price: number;
  description: string;
  active: boolean;
}

export interface AvailabilityRule {
  id: string;
  dayOfWeek: number; // 0 = Sunday
  startTime: string; // HH:MM, site timezone
  endTime: string;
}

export interface Slot {
  startUtc: string;
  endUtc: string;
}

export interface Booking {
  id: string;
  siteId: string;
  serviceId: string;
  customerName: string;
  customerEmail: string;
  notes: string;
  startUtc: string;
  endUtc: string;
  status: "confirmed" | "cancelled";
}
