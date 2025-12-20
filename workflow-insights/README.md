# mikeburns.ai

Personal portfolio and project showcase featuring AI-powered compliance and political intelligence tools.

## Project Structure

```
mikeburns.ai/
├── index.html                          # Landing page
├── profile-photo.jpg                   # Your professional photo
├── resume.pdf                          # Your resume (you'll add this)
├── cliftonstrengths.pdf               # CliftonStrengths assessment (you'll add this)
├── highlands.pdf                       # Highlands assessment (you'll add this)
└── workflow-insights/
    └── index.html                      # Workflow Insights tool
```

## Deployment Instructions

### Option 1: Deploy to Vercel (Recommended - Easiest)

1. **Create GitHub Repository**
   ```bash
   cd /path/to/your/mikeburns.ai
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/meb226/mikeburns.ai.git
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to [vercel.com](https://vercel.com) and sign in with GitHub
   - Click "Add New Project"
   - Import your `mikeburns.ai` repository
   - Click "Deploy" (no configuration needed)
   - Your site will be live at `https://your-project.vercel.app`

3. **Connect Custom Domain**
   - In Vercel dashboard, go to your project → Settings → Domains
   - Add `mikeburns.ai` and `www.mikeburns.ai`
   - Vercel will give you DNS records to add
   - Go to your domain registrar and add these DNS records:
     - Type: A, Name: @, Value: 76.76.21.21
     - Type: CNAME, Name: www, Value: cname.vercel-dns.com
   - Wait 24-48 hours for DNS propagation

### Option 2: Deploy to GitHub Pages

1. **Create Repository**
   - Go to GitHub and create a new repository named `mikeburns.ai`
   - Push your code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/meb226/mikeburns.ai.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Source: Deploy from branch `main`, folder `/ (root)`
   - Click Save
   - Site will be at `https://meb226.github.io/mikeburns.ai`

3. **Connect Custom Domain**
   - In Settings → Pages, add custom domain `mikeburns.ai`
   - Add DNS records at your domain registrar:
     - Type: A, Name: @, Value: 185.199.108.153
     - Type: A, Name: @, Value: 185.199.109.153
     - Type: A, Name: @, Value: 185.199.110.153
     - Type: A, Name: @, Value: 185.199.111.153
     - Type: CNAME, Name: www, Value: meb226.github.io

### Option 3: Deploy to Netlify

1. **Create GitHub Repository** (same as above)

2. **Deploy to Netlify**
   - Go to [netlify.com](https://netlify.com) and sign in with GitHub
   - Click "Add new site" → "Import an existing project"
   - Select your `mikeburns.ai` repository
   - Click "Deploy site"

3. **Connect Custom Domain**
   - Go to Site settings → Domain management
   - Add custom domain `mikeburns.ai`
   - Follow Netlify's DNS instructions

## Before You Deploy

1. **Add your PDFs** to the root directory:
   - `resume.pdf`
   - `cliftonstrengths.pdf`
   - `highlands.pdf`

2. **Test locally**:
   - Open `index.html` in a browser
   - Make sure photo displays correctly
   - Test all links

3. **Push to GitHub**:
   ```bash
   git add resume.pdf cliftonstrengths.pdf highlands.pdf
   git commit -m "Add assessment PDFs"
   git push
   ```

## Updating Your Site

To update any content:
```bash
# Make your changes
git add .
git commit -m "Description of changes"
git push
```

Your hosting platform (Vercel/Netlify/GitHub Pages) will automatically redeploy.

## Future Enhancements

- Add more projects as you build them
- Add a blog section
- Add analytics (Google Analytics or Plausible)
- Add contact form
- Add dark mode toggle

## Support

- Vercel Docs: https://vercel.com/docs
- GitHub Pages Docs: https://docs.github.com/en/pages
- Netlify Docs: https://docs.netlify.com

---

Built with care by Mike Burns
