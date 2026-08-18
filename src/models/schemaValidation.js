export const ISO_DATE_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export const isoDateKey = (options = {}) => ({
  type: String,
  required: true,
  match: [ISO_DATE_KEY_REGEX, "La fecha debe usar el formato YYYY-MM-DD"],
  ...options,
});

export const maxArrayLength = (maximum, label) => ({
  validator: (value) => !Array.isArray(value) || value.length <= maximum,
  message: `${label} supera el limite de ${maximum} elementos`,
});
