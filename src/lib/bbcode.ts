const escape = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function parseBBCode(raw: string): string {
  let s = escape(raw);

  s = s.replace(
    /\[quote=([^\]]+)\]([\s\S]*?)\[\/quote\]/gi,
    (_, user, content) =>
      `<blockquote class="bbcode-quote"><cite>${escape(
        user
      )} wrote:</cite>${content}</blockquote>`
  );
  s = s.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    (_, content) => `<blockquote class="bbcode-quote">${content}</blockquote>`
  );

  s = s.replace(
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    (_, content) => `<pre class="bbcode-code"><code>${content}</code></pre>`
  );

  s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, content) => {
    const items = content
      .split(/\[\*\]/)
      .filter((i: string) => i.trim())
      .map((i: string) => `<li>${i.trim()}</li>`)
      .join('');
    return `<ul class="bbcode-list">${items}</ul>`;
  });

  s = s.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
  s = s.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
  s = s.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
  s = s.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');

  s = s.replace(
    /\[color=([a-zA-Z0-9#]+)\](.*?)\[\/color\]/gi,
    '<span style="color:$1">$2</span>'
  );

  s = s.replace(/\[size=(\d+)\](.*?)\[\/size\]/gi, (_, n, content) => {
    const pt = Math.min(24, Math.max(8, parseInt(n)));
    return `<span style="font-size:${pt}pt">${content}</span>`;
  });

  s = s.replace(
    /\[url=([^\]]+)\](.*?)\[\/url\]/gi,
    (_, url, text) => {
      const safe =
        /^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('mailto:')
          ? url
          : '#';
      return `<a href="${safe}" rel="noopener noreferrer" target="_blank">${text}</a>`;
    }
  );
  s = s.replace(
    /\[url](https?:\/\/[^[]+)\[\/url]/gi,
    '<a href="$1" rel="noopener noreferrer" target="_blank">$1</a>'
  );

  s = s.replace(
    /\[img](https?:\/\/[^[]+)\[\/img]/gi,
    '<img src="$1" alt="" class="bbcode-img" />'
  );

  s = s.replace(/\n/g, '<br />');

  return s;
}
