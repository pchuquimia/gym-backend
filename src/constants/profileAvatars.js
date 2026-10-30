export const PROFILE_AVATAR_IDS = Array.from({ length: 18 }, (_, index) => `gym-${String(index + 1).padStart(2, "0")}`);

const originalGenders = ["male", "female", "male", "female", "male", "female"];
export const getProfileAvatarGender = (id) => {
  const index = PROFILE_AVATAR_IDS.indexOf(id);
  return index < 0 ? "" : index < 6 ? originalGenders[index] : index < 12 ? "male" : "female";
};

export const resolveProfileAvatarId = ({ avatarId = "", name = "", gender = "" }) => {
  const knownGender = ["male", "female"].includes(gender);
  const selectedGender = getProfileAvatarGender(avatarId);
  if (selectedGender && (!knownGender || selectedGender === gender)) return avatarId;
  if (!knownGender) return "";
  const candidates = PROFILE_AVATAR_IDS.filter((id) => getProfileAvatarGender(id) === gender);
  const hash = Array.from(String(name || "").trim().toLocaleLowerCase("es").normalize("NFC")).reduce((value, letter) => (Math.imul(value, 31) + letter.codePointAt(0)) >>> 0, 0);
  return candidates[hash % candidates.length];
};
