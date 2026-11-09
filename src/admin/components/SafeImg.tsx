// An <img> that falls back to the site's placeholder when the file can't be loaded.
import { useEffect, useState, type ImgHTMLAttributes } from 'react';

export default function SafeImg({ src, alt = '', className, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (broken || !src) {
    return (
      <div className={`img-ph${className ? ` ${className}` : ''}`} {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}>
        sxingxian
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} {...rest} />;
}
