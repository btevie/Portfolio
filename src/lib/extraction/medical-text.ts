import { looksMedical } from "../medical";

/** True when this text looks like a health document. Those never go to the AI reader. */
export const isMedicalText = (text: string): boolean => looksMedical("", [text]) || /\b(patient|diagnos\w*|cpt|icd-?10|explanation of benefits|eob|ziekenhuis|zorgverzekering|huisarts|tandarts)\b/i.test(text);

