export const maskPII = {
  // Masks name: "William" -> "W*****m"
  name: (name: string) => {
    if (!name || name.length <= 2) return "***";
    const first = name.charAt(0);
    const last = name.charAt(name.length - 1);
    return `${first}${"*".repeat(name.length - 2)}${last}`;
  },

  // Masks phone: "+60123456789" -> "+********89"
  phone: (phone: string) => {
    if (!phone || phone.length < 4) return "***";
    const lastTwo = phone.slice(-2);
    const prefix = phone.startsWith("+") ? "+" : "";
    return `${prefix}${"*".repeat(phone.length - 2 - prefix.length)}${lastTwo}`;
  },

  // Masks address string: "123 Main Street" -> "123 M*** S*****"
  address: (address: string) => {
    if (!address) return "***";
    return address.replace(/[a-zA-Z]+/g, (word) => {
      if (word.length <= 1) return word;
      return `${word.charAt(0)}${"*".repeat(word.length - 1)}`;
    });
  }
};
