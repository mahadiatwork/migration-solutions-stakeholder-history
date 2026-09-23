/**
 * Compatibility defaults used when Widget_Picklist_Config cannot be read.
 */

export const durationOptions = Array.from(
  { length: 49 },
  (_, index) => index * 5
);

export const mandatoryActivityTypes = {
  "Communication & Meetings": ["Call", "Email", "Meeting", "Consultation"],
  "Assessment & Analysis": [
    "Assessment",
    "Research",
    "Strategy & Problem Solving",
    "Evidence & Risk Analysis",
  ],
  "Technical casework": [
    "Document Collection/Management",
    "Document Review",
    "Drafting/Preparation",
    "Review/Checking",
    "Amendments",
    "Lodgement/Submission",
    "RFI",
  ],
  Administration: [
    "Matter Administration",
    "CRM/File Management",
    "Allocation/Handover",
    "Billing/Payment",
    "Closure/Archiving",
  ],
  Other: [
    "Training",
    "Business Development",
    "Internal Project/Process Improvement",
    "Internal Meeting",
    "General Management",
    "Other",
  ],
};

export const mandatoryCategoryOptions = Object.keys(mandatoryActivityTypes);

export const typeOptions = [
  ...mandatoryCategoryOptions,
  "Meeting",
  "To-Do",
  "Appointment",
  "Boardroom",
  "Call Billing",
  "Email Billing",
  "Initial Consultation",
  "Call",
  "Mail",
  "Meeting Billing",
  "Personal Activity",
  "Room 1",
  "Room 2",
  "Room 3",
  "To Do Billing",
  "Vacation",
];

export const resultMapping = {
  "Communication & Meetings": "Call",
  "Assessment & Analysis": "Assessment",
  "Technical casework": "Document Collection/Management",
  Administration: "Matter Administration",
  Other: "Training",
  Meeting: "Meeting Held",
  "To-Do": "To-do Done",
  Appointment: "Appointment Completed",
  Boardroom: "Boardroom - Completed",
  "Call Billing": "Call Billing - Completed",
  "Email Billing": "Mail - Completed",
  "Initial Consultation": "Initial Consultation - Completed",
  Call: "Call Completed",
  Mail: "Mail Sent",
  "Meeting Billing": "Meeting Billing - Completed",
  "Personal Activity": "Personal Activity - Completed",
  "Room 1": "Room 1 - Completed",
  "Room 2": "Room 2 - Completed",
  "Room 3": "Room 3 - Completed",
  "To Do Billing": "To Do Billing - Completed",
  Vacation: "Vacation - Completed",
};
