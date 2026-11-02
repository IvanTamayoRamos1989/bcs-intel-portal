import unittest
import collect
class CollectorTests(unittest.TestCase):
 def test_viewer_unwrap(self):
  self.assertEqual(collect.canonical('/viewer.php?file=https%3A%2F%2Ffinanzas.bcs.gob.mx%2Fa.pdf',collect.BASE),collect.BASE+'a.pdf')
 def test_no_action_urls(self):
  for url in ['javascript:alert(1)','#section','mailto:a@b.mx']:
   self.assertIsNone(collect.canonical(url,collect.BASE))
 def test_options_are_not_relative_urls(self):
  p=collect.Links();p.feed('<select id="year"><option value="2026">2026</option><option value="a.pdf">A</option></select>')
  self.assertEqual(p.links,[])
 def test_index_preserved(self):
  p=collect.Links();p.feed('<select id="docs"><option>Header</option><option value="a.pdf">A</option></select>')
  self.assertEqual(p.selects['docs'],[None,'a.pdf'])
 def test_explicit_document_expansion(self):
  s='''function f(){d=document.getElementById("docs").value;window.open('/files/'+d+'.xlsx');}'''
  self.assertIn(('/files/ingresos.xlsx','Enlace de selector oficial'),collect.dynamic_links(s,{'docs':['ingresos']}))
 def test_branch_uses_option_index(self):
  s='''function f(){d=document.getElementById("docs").value;combo=document.getElementById("docs");if(combo.selectedIndex >= 1 && combo.selectedIndex <= 1){c="contable/"}if(combo.selectedIndex >= 2 && combo.selectedIndex <= 2){c="presupuesto/"}var url='/files/'+c+d;window.open(url,'_blank');}'''
  found=set(u for u,_ in collect.dynamic_links(s,{'docs':[None,'a.pdf','b.pdf']}))
  self.assertEqual(found,{'/files/contable/a.pdf','/files/presupuesto/b.pdf'})
if __name__=='__main__':unittest.main()
