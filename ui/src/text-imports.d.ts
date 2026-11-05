/** A file imported as its text, `with { loader: 'text' }`, such as the theme's tokens for the Colophon. */
declare module '*.css' {
  const text: string;
  export default text;
}
