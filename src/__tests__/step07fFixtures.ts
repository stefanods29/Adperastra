/** Raw HTML fixtures for the 07f tests, kept outside .tsx so the translation
 * checker does not mistake markup for UI text. */
export const okParagraph = "<p>ok</p>";
export const scriptedHtml = "<p>ok</p><script>window.pwned=1</script>";
export const imageHtml =
  '<p>before</p><img src="book-resource:OEBPS/a.png"><p>after</p>';
export const subtitleMarkup = "Hello <b>world</b>";
export const safeMarkupHtml =
  '<p>ok</p><script>window.pwned=1</script><img src="https://tracker/x.png">';
